import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

const BUCKET = "travel-documents";

const VERDICT_LABELS = {
  likely_valid: { text: "Looks valid", cls: "ok" },
  uncertain: { text: "Uncertain", cls: "warn" },
  likely_invalid: { text: "Likely invalid", cls: "bad" },
};

function storagePath(documentUrl) {
  // document_url is the object path inside the bucket (<user_id>/<ts>.<ext>).
  // Tolerate a full storage URL in case an older row stored one.
  const marker = `/${BUCKET}/`;
  const i = documentUrl.indexOf(marker);
  return i >= 0 ? decodeURIComponent(documentUrl.slice(i + marker.length).split("?")[0]) : documentUrl;
}

function isPdf(path) {
  return /\.pdf$/i.test(path);
}

function previewKind(path, mimeType) {
  if (mimeType === "application/pdf" || isPdf(path)) return "pdf";
  if (mimeType?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(path)) return "image";
  return null;
}

// Admin-only. The bucket is private, so the image is fetched through a
// short-lived signed URL, created only when the admin toggles it open and
// discarded when it is hidden. Storage RLS (see
// 20261030_travel_card_lifecycle.sql) is what actually restricts this to admins.
export default function GovtIdViewer({ card }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestRef = useRef(0);

  useEffect(() => () => {
    requestRef.current += 1;
    if (preview?.url) URL.revokeObjectURL(preview.url);
  }, [preview?.url]);

  const path = card.document_url ? storagePath(card.document_url) : null;
  const verdict = VERDICT_LABELS[card.document_verdict];

  async function viewDocument() {
    if (open) {
      requestRef.current += 1;
      setOpen(false);
      return;
    }
    if (!path) return;
    const myRequest = ++requestRef.current;
    setOpen(true);
    setLoading(true);
    setError(null);
    // Fetch the authenticated object as a Blob instead of embedding a signed
    // URL. This avoids an object metadata/content-disposition setting forcing
    // a download (or producing a blank iframe) for an otherwise viewable ID.
    const { data, error: err } = await supabase.storage.from(BUCKET).download(path);
    if (myRequest !== requestRef.current) return; // toggled off / card changed meanwhile
    setLoading(false);
    if (err || !data) {
      console.error("Could not load ID document:", err);
      setError(err?.message || "Could not load the document.");
      return;
    }
    const kind = previewKind(path, data.type);
    if (!kind) {
      setError("This file type cannot be previewed in the dashboard. Use Download to save it.");
      return;
    }
    // Some existing uploads were stored as application/octet-stream. A Blob
    // URL preserves that generic type, causing Chromium to show raw "%PDF"
    // bytes in the iframe. The object name is authoritative for these uploads.
    const previewBlob = kind === "pdf" && data.type !== "application/pdf"
      ? new Blob([data], { type: "application/pdf" })
      : data;
    setPreview((old) => {
      if (old?.url) URL.revokeObjectURL(old.url);
      return { url: URL.createObjectURL(previewBlob), kind };
    });
  }

  async function downloadDocument() {
    if (!path) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.storage.from(BUCKET).download(path);
    setLoading(false);
    if (err || !data) { setError(err?.message || "Could not download the document."); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(data);
    a.download = path.split("/").pop() || "government-id";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 0);
  }

  return (
    <div className="govt-id">
      <div className="govt-id-row">
        <span className="govt-id-type">{card.document_type}</span>
        {card.id_number && <span className="govt-id-number">{card.id_number}</span>}
      </div>

      {(verdict || card.document_id_number_match != null) && (
        <div className="govt-id-badges">
          {verdict && <span className={`govt-id-badge ${verdict.cls}`}>{verdict.text}</span>}
          {card.document_id_number_match === true && <span className="govt-id-badge ok">ID number matches</span>}
          {card.document_id_number_match === false && <span className="govt-id-badge bad">ID number mismatch</span>}
        </div>
      )}
      {card.document_reasoning && <div className="govt-id-reason">{card.document_reasoning}</div>}

      {path ? (
        <div className="govt-id-actions">
          <button type="button" className="govt-id-toggle" onClick={viewDocument} aria-expanded={open}>
            {open ? "Hide" : "View"}
          </button>
          <button type="button" className="govt-id-download" onClick={downloadDocument}>Download</button>
        </div>
      ) : (
        <div className="govt-id-none">No document file was uploaded.</div>
      )}

      {open && (
        <div className="govt-id-preview">
          {loading && <div className="govt-id-status">Loading…</div>}
          {error && <div className="govt-id-status error">{error}</div>}
          {preview?.kind === "image" && (
            <img
                src={preview.url}
                alt={`${card.document_type || "Government ID"} uploaded by ${card.full_name || "traveller"}`}
                onError={() => setError("The image could not be rendered. Use Download to save it.")}
              />
          )}
          {preview?.kind === "pdf" && (
            <iframe title="Government ID" src={preview.url} />
          )}
        </div>
      )}
    </div>
  );
}

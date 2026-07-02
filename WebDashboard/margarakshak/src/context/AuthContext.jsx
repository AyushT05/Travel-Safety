import { createContext, useContext, useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [profile, setProfile] = useState(null);
  const [trackedIds, setTrackedIds] = useState([]);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchProfile(session.user.id);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchProfile(session.user.id);
      else { setProfile(null); setTrackedIds([]); }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile(userId) {
    const { data } = await supabase
      .from("profiles")
      .select("role, tracked_ids")
      .eq("id", userId)
      .single();
    if (data) {
      setProfile(data);
      setTrackedIds(data.tracked_ids || []);
    }
  }

  async function updateTrackedIds(ids) {
    if (!session) return;
    setTrackedIds(ids);
    await supabase
      .from("profiles")
      .update({ tracked_ids: ids })
      .eq("id", session.user.id);
  }

  function addTrackedId(id) {
    const trimmed = id.trim();
    if (!trimmed || trackedIds.includes(trimmed)) return false;
    updateTrackedIds([...trackedIds, trimmed]);
    return true;
  }

  function removeTrackedId(id) {
    updateTrackedIds(trackedIds.filter(t => t !== id));
  }

  const user = session?.user;
  const auth = session && user ? {
    id: user.id,
    name: user.user_metadata?.full_name || user.email?.split("@")[0] || "User",
    email: user.email,
    avatar: user.user_metadata?.avatar_url,
    role: profile?.role || "user",
    trackedIds,
  } : null;

  return (
    <AuthContext.Provider value={{
      auth,
      isLoaded: session !== undefined,
      logout: () => supabase.auth.signOut(),
      addTrackedId,
      removeTrackedId,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
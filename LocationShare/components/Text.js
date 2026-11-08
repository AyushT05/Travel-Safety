import React from 'react';
import { Text as RNText, TextInput as RNTextInput, StyleSheet } from 'react-native';

// Manrope faces by weight. Custom fonts on Android ignore fontWeight, so we
// pick the face here and neutralise fontWeight.
const FACE = {
  normal: 'Manrope_400Regular', '400': 'Manrope_400Regular', '500': 'Manrope_500Medium',
  '600': 'Manrope_600SemiBold', '700': 'Manrope_700Bold', bold: 'Manrope_700Bold',
  '800': 'Manrope_800ExtraBold', '900': 'Manrope_800ExtraBold',
};

function withFont(style) {
  const f = StyleSheet.flatten(style) || {};
  if (f.fontFamily) return style; // explicit family (e.g. monospace) wins
  return [style, { fontFamily: FACE[String(f.fontWeight || '400')] || FACE['400'], fontWeight: 'normal' }];
}

export function Text({ style, ...props }) {
  return <RNText {...props} style={withFont(style)} />;
}

export function TextInput({ style, ...props }) {
  return <RNTextInput {...props} style={withFont(style)} />;
}

export const DISPLAY = 'Manrope_700Bold';

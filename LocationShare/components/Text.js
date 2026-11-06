import React from 'react';
import { Text as RNText, TextInput as RNTextInput, StyleSheet } from 'react-native';

// Plus Jakarta Sans faces by weight. Custom fonts on Android ignore fontWeight, so we
// pick the face here and neutralise fontWeight.
const FACE = {
  normal: 'PlusJakartaSans_400Regular', '400': 'PlusJakartaSans_400Regular', '500': 'PlusJakartaSans_500Medium',
  '600': 'PlusJakartaSans_600SemiBold', '700': 'PlusJakartaSans_700Bold', bold: 'PlusJakartaSans_700Bold',
  '800': 'PlusJakartaSans_800ExtraBold', '900': 'PlusJakartaSans_800ExtraBold',
};

function withFont(style) {
  const f = StyleSheet.flatten(style) || {};
  if (f.fontFamily) return style; // explicit family (e.g. Fraunces, monospace) wins
  return [style, { fontFamily: FACE[String(f.fontWeight || '400')] || FACE['400'], fontWeight: 'normal' }];
}

export function Text({ style, ...props }) {
  return <RNText {...props} style={withFont(style)} />;
}

export function TextInput({ style, ...props }) {
  return <RNTextInput {...props} style={withFont(style)} />;
}

export const DISPLAY = 'PlusJakartaSans_700Bold';

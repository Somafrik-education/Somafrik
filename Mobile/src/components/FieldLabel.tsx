import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";
import {
  FORM_LABEL_COLOR,
  FORM_REQUIRED_MARK_COLOR,
  formatFieldLabel,
} from "../lib/formFieldTokens";

type FieldLabelProps = {
  label: string;
  required?: boolean;
  optional?: boolean;
  style?: StyleProp<TextStyle>;
};

/** Libellé visible : le `*` rouge n'est rendu que si le champ est réellement obligatoire. */
export function FieldLabel({ label, required, optional, style }: FieldLabelProps) {
  return (
    <Text style={[styles.label, style]}>
      {label}
      {required ? (
        <Text style={styles.requiredMark} testID="required-mark">
          {" *"}
        </Text>
      ) : null}
      {optional && !required ? " — facultatif" : null}
    </Text>
  );
}

export function fieldLabelAccessibility(label: string, options?: { required?: boolean; optional?: boolean }) {
  return formatFieldLabel(label, options);
}

const styles = StyleSheet.create({
  label: { color: FORM_LABEL_COLOR, fontSize: 12, fontWeight: "900", marginBottom: 6 },
  requiredMark: { color: FORM_REQUIRED_MARK_COLOR, fontWeight: "900" },
});

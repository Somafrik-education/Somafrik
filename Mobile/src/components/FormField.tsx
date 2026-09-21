import { forwardRef, useState, type ReactNode } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  FORM_BORDER_COLOR,
  FORM_BORDER_ERROR_COLOR,
  FORM_ERROR_COLOR,
  FORM_HELPER_COLOR,
  FORM_PLACEHOLDER_COLOR,
  FORM_SURFACE_COLOR,
  FORM_VALUE_COLOR,
  formatFieldLabel,
  type FormFieldType,
} from "../lib/formFieldTokens";
import { FieldLabel } from "./FieldLabel";

export type FormFieldProps = Omit<TextInputProps, "placeholderTextColor" | "style"> & {
  label: string;
  required?: boolean;
  optional?: boolean;
  error?: string;
  helperText?: string;
  type?: FormFieldType;
  leading?: ReactNode;
  hideVisibleLabel?: boolean;
  variant?: "default" | "compact";
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
};

const TYPE_DEFAULTS: Record<FormFieldType, Partial<TextInputProps>> = {
  text: { autoCapitalize: "sentences" },
  name: { autoCapitalize: "words", autoCorrect: false },
  email: {
    keyboardType: "email-address",
    autoCapitalize: "none",
    autoCorrect: false,
    autoComplete: "email",
    textContentType: "emailAddress",
  },
  phone: { keyboardType: "phone-pad", autoComplete: "tel", textContentType: "telephoneNumber" },
  date: { keyboardType: "numbers-and-punctuation", autoCapitalize: "none", autoCorrect: false },
  time: { keyboardType: "numbers-and-punctuation", autoCapitalize: "none", autoCorrect: false },
  password: {
    secureTextEntry: true,
    autoCapitalize: "none",
    autoCorrect: false,
    autoComplete: "password",
    textContentType: "password",
  },
  amount: { keyboardType: "numeric" },
  multiline: { multiline: true, textAlignVertical: "top", autoCapitalize: "sentences" },
  code: { autoCapitalize: "characters", autoCorrect: false },
  search: { autoCapitalize: "none", autoCorrect: false, returnKeyType: "search" },
  url: { keyboardType: "url", autoCapitalize: "none", autoCorrect: false },
};

const FormField = forwardRef<TextInput, FormFieldProps>(function FormField(
  {
    label,
    required,
    optional,
    error,
    helperText,
    type = "text",
    leading,
    hideVisibleLabel,
    variant = "default",
    containerStyle,
    inputStyle,
    accessibilityLabel,
    editable = true,
    ...inputProps
  },
  ref,
) {
  const accessibleLabel = formatFieldLabel(label, { required, optional });
  const defaults = TYPE_DEFAULTS[type];
  const invalid = Boolean(error && String(error).trim());
  const isPassword = type === "password";
  const [passwordVisible, setPasswordVisible] = useState(false);

  return (
    <View style={[styles.block, variant === "compact" && styles.compactBlock, containerStyle]}>
      {hideVisibleLabel ? null : <FieldLabel label={label} required={required} optional={optional} />}
      <View
        style={[
          styles.shell,
          variant === "compact" && styles.compactShell,
          invalid && styles.shellInvalid,
          !editable && styles.shellDisabled,
        ]}
      >
        {leading ? <View style={styles.leading}>{leading}</View> : null}
        <TextInput
          ref={ref}
          {...defaults}
          {...inputProps}
          editable={editable}
          secureTextEntry={isPassword ? !passwordVisible : inputProps.secureTextEntry}
          placeholderTextColor={FORM_PLACEHOLDER_COLOR}
          accessibilityLabel={accessibilityLabel ?? accessibleLabel}
          style={[
            styles.input,
            type === "multiline" && styles.multiline,
            variant === "compact" && styles.compactInput,
            inputStyle,
          ]}
        />
        {isPassword ? (
          <TouchableOpacity
            style={styles.passwordToggle}
            onPress={() => setPasswordVisible((visible) => !visible)}
            disabled={!editable}
            hitSlop={6}
            testID={inputProps.testID ? `${inputProps.testID}-visibility-toggle` : undefined}
            accessibilityRole="button"
            accessibilityLabel={passwordVisible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
            accessibilityState={{ disabled: !editable, selected: passwordVisible }}
          >
            <Ionicons
              name={passwordVisible ? "eye-off-outline" : "eye-outline"}
              size={20}
              color={FORM_HELPER_COLOR}
            />
          </TouchableOpacity>
        ) : null}
      </View>
      {invalid ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : helperText ? (
        <Text style={styles.helper}>{helperText}</Text>
      ) : null}
    </View>
  );
});

export default FormField;

const styles = StyleSheet.create({
  block: { marginBottom: 10 },
  compactBlock: { marginBottom: 0 },
  shell: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: FORM_SURFACE_COLOR,
    borderWidth: 1,
    borderColor: FORM_BORDER_COLOR,
    borderRadius: 14,
    paddingHorizontal: 12,
  },
  compactShell: { borderRadius: 14, paddingHorizontal: 8 },
  shellInvalid: { borderColor: FORM_BORDER_ERROR_COLOR },
  shellDisabled: { opacity: 0.65 },
  leading: { marginRight: 8 },
  passwordToggle: {
    width: 44,
    height: 44,
    marginRight: -8,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 12,
    color: FORM_VALUE_COLOR,
    fontWeight: "700",
  },
  compactInput: { minHeight: 44, paddingVertical: 8, textAlign: "center" },
  multiline: { minHeight: 100, paddingTop: 12 },
  error: { color: FORM_ERROR_COLOR, fontWeight: "800", marginTop: 6 },
  helper: { color: FORM_HELPER_COLOR, fontWeight: "700", marginTop: 6 },
});

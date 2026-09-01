import { StyleSheet, Text } from "react-native";
import { useAdminData } from "../context/AdminDataContext";

/**
 * Fail-closed visible : même erreur que AdminDataContext.studentsScopeError.
 * Les écrans ne recalculent pas la projection élèves.
 */
export default function StudentsScopeAlert() {
  const { studentsScopeError } = useAdminData();
  if (!studentsScopeError) return null;
  return (
    <Text
      style={styles.error}
      testID="students-scope-error"
      accessibilityRole="alert"
    >
      {studentsScopeError}
    </Text>
  );
}

const styles = StyleSheet.create({
  error: {
    color: "#B91C1C",
    fontWeight: "700",
    marginBottom: 12,
  },
});

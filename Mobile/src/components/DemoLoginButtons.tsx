import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { demoIdentifierFor, resolveDemoPin, type DemoAccountKind } from "../data/demoCredentials";

type Props = {
  accessRole?: string;
  onFill: (identifier: string, pin: string) => void;
};

const KINDS: Array<{ kind: DemoAccountKind; label: string }> = [
  { kind: "teacher", label: "Remplir un compte enseignant démo" },
  { kind: "school_admin", label: "Remplir administrateur établissement démo" },
  { kind: "prefet", label: "Remplir préfet des études démo" },
  { kind: "secretary", label: "Remplir secrétaire démo" },
  { kind: "country_admin", label: "Remplir administrateur pays démo" },
];

export default function DemoLoginButtons({ accessRole, onFill }: Props) {
  const pin = resolveDemoPin();
  if (!pin) return null;

  return (
    <View>
      {KINDS.map((row) => (
        <TouchableOpacity
          key={row.kind}
          style={styles.demoButton}
          onPress={() => onFill(accessRole ? "" : demoIdentifierFor(row.kind), pin)}
        >
          <Text style={styles.demoButtonText}>{row.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  demoButton: {
    marginTop: 12,
    paddingVertical: 10,
  },
  demoButtonText: {
    color: "#2563EB",
    fontWeight: "700",
    fontSize: 13,
    textAlign: "center",
  },
});

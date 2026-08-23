import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import AccessibleIconButton from "./AccessibleIconButton";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { OVERFLOW_MENU_ITEM_DP, OVERFLOW_TRIGGER_DP, type OverflowActionSpec } from "../lib/overflowActions";

export type OverflowAction = OverflowActionSpec & {
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
};

export default function OverflowActions({
  actions,
  accessibilityLabel,
  testID = "overflow-actions",
}: {
  actions: OverflowAction[];
  accessibilityLabel: string;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const visible = actions.filter((action) => action.key && action.label);

  if (!visible.length) return null;

  const close = () => setOpen(false);

  return (
    <View>
      <AccessibleIconButton
        icon="ellipsis-vertical"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Ouvre les actions disponibles"
        onPress={() => setOpen(true)}
        testID={testID}
        style={styles.trigger}
      />
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.backdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Fermer le menu"
          />
          <View style={styles.sheet} accessibilityViewIsModal>
            {visible.map((action) => (
              <TouchableOpacity
                key={action.key}
                style={styles.item}
                onPress={() => {
                  close();
                  action.onPress();
                }}
                disabled={action.disabled}
                accessibilityRole="button"
                accessibilityLabel={action.accessibilityLabel ?? action.label}
                accessibilityState={{ disabled: Boolean(action.disabled) }}
                testID={action.testID ?? `overflow-action-${action.key}`}
              >
                <Text style={[styles.itemText, action.destructive && styles.itemDanger]}>{action.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.item}
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Annuler"
              testID="overflow-action-cancel"
            >
              <Text style={styles.cancelText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: OVERFLOW_TRIGGER_DP,
    height: OVERFLOW_TRIGGER_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    minHeight: MIN_TOUCH_TARGET_DP,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.45)",
    justifyContent: "flex-end",
    padding: 16,
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    overflow: "hidden",
  },
  item: {
    minHeight: OVERFLOW_MENU_ITEM_DP,
    paddingHorizontal: 18,
    justifyContent: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E2E8F0",
  },
  itemText: {
    color: "#0F172A",
    fontWeight: "800",
    fontSize: 16,
  },
  itemDanger: {
    color: "#B91C1C",
  },
  cancelText: {
    color: "#64748B",
    fontWeight: "800",
    fontSize: 16,
  },
});

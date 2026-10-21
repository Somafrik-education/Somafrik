/**
 * CARTE-FIX-QR-NFC — capture ponctuelle du QR imprimé d'une carte élève (encodage NFC ou relecture).
 * Aucune présence, aucun appel réseau : le jeton lu est remis une seule fois à l'appelant, en
 * mémoire, puis la caméra s'arrête. Il n'est ni affiché, ni persisté, ni journalisé.
 */
import { useCallback, useEffect, useRef } from "react";
import { Modal, Text, TouchableOpacity, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { extractQrCapability, isQrBarcodeType } from "../lib/studentCardScan";

type Props = { visible: boolean; title: string; onToken: (cardToken: string) => void; onCancel: () => void };

export function StudentCardQrCaptureModal({ visible, title, onToken, onCancel }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const delivered = useRef(false);
  useEffect(() => { if (visible) delivered.current = false; }, [visible]);
  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission, visible]);
  const onBarcodeScanned = useCallback((result: BarcodeScanningResult) => {
    if (delivered.current || !isQrBarcodeType(result.type)) return;
    const value = extractQrCapability(result.data);
    if (!value) return;
    delivered.current = true;
    onToken(value);
  }, [onToken]);
  return <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
    <View testID="student-card-qr-capture" style={{ flex: 1, padding: 16, backgroundColor: "#FFFFFF" }}>
      <Text style={{ fontSize: 18, fontWeight: "600", marginBottom: 8 }}>{title}</Text>
      <Text style={{ marginBottom: 12 }}>Présentez le QR code imprimé de cette carte devant la caméra.</Text>
      {visible && permission?.granted ? <View style={{ flex: 1, borderRadius: 12, overflow: "hidden" }}>
        <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={onBarcodeScanned} />
      </View> : <Text>{permission && !permission.granted && !permission.canAskAgain
        ? "Accès à la caméra refusé. Autorisez-le dans les réglages du téléphone."
        : "Autorisation de la caméra en cours…"}</Text>}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Annuler la lecture du QR code" onPress={onCancel} style={{ padding: 14, marginTop: 12, alignItems: "center" }}>
        <Text>Annuler</Text>
      </TouchableOpacity>
    </View>
  </Modal>;
}

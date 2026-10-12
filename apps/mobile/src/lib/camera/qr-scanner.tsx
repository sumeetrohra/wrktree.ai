import { CameraView, useCameraPermissions } from "expo-camera";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

export type TQrScannerProps = { onScanned: (data: string) => void };

/** Camera view that reports the first QR code it sees (pairing). Asks for permission first. */
export function QrScanner({ onScanned }: TQrScannerProps): React.JSX.Element {
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  if (!permission?.granted) {
    return (
      <View className="items-center gap-3 p-4">
        <Text className="text-muted-foreground">{t("pairing.cameraNeeded")}</Text>
        <Button
          onPress={() => {
            void requestPermission();
          }}
        >
          <Text>{t("pairing.allowCamera")}</Text>
        </Button>
      </View>
    );
  }
  return (
    <CameraView
      className="aspect-square w-full overflow-hidden rounded-xl"
      barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
      onBarcodeScanned={({ data }) => {
        onScanned(data);
      }}
    />
  );
}

import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  View,
  Image,
  ScrollView,
} from "react-native";
import { Button, Text, TextInput, useTheme } from "react-native-paper";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IMAGE_QUALITY = 0.6;
const SCANNER_INPUT_THEME = { animation: { scale: 0 } };

export type ScannedLabelData = {
  title: string;
  servingSize: string;
  servingsPerContainer?: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
};

type LabelScannerProps = {
  visible: boolean;
  onClose: () => void;
  onLabelScanned: (data: ScannedLabelData, portions: number) => void;
  isProcessing?: boolean;
  parseLabelImage: (imageUri: string) => Promise<ScannedLabelData>;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  camera: {
    flex: 1,
  },
  cameraContainer: {
    flex: 1,
    position: "relative",
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "column",
    justifyContent: "flex-end",
    pointerEvents: "box-none",
  },
  controlsWrapper: {
    pointerEvents: "auto",
  },
  controls: {
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    paddingVertical: 16,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  button: {
    flex: 1,
  },
  previewModal: {
    flex: 1,
    justifyContent: "flex-end",
  },
  previewContent: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    maxHeight: "90%",
  },
  previewImage: {
    width: "100%",
    height: 200,
    borderRadius: 8,
    marginBottom: 16,
  },
  servingSizeText: {
    marginTop: 8,
    marginBottom: 4,
  },
  nutritionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginVertical: 12,
  },
  nutritionCard: {
    flex: 1,
    minWidth: "48%",
    padding: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  nutritionLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  nutritionValue: {
    fontSize: 16,
    fontWeight: "700",
    marginTop: 4,
  },
});

export function NutritionLabelScanner({
  visible,
  onClose,
  onLabelScanned,
  isProcessing,
  parseLabelImage,
}: LabelScannerProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const [cameraActive, setCameraActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [scannedData, setScannedData] = useState<ScannedLabelData | null>(null);
  const [editedData, setEditedData] = useState<ScannedLabelData | null>(null);
  const [portions, setPortions] = useState("1");
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseLoading, setParseLoading] = useState(false);
  const [fullImageVisible, setFullImageVisible] = useState(false);
  const ocrPortionsRef = useRef(1);

  useEffect(() => {
    if (visible) {
      // Request camera permission when modal opens
      if (!permission?.granted) {
        requestPermission();
      } else {
        setCameraActive(true);
      }
      setCapturedImage(null);
      setScannedData(null);
      setEditedData(null);
      setPortions("1");
      setParseError(null);
      ocrPortionsRef.current = 1;
    }
  }, [visible, permission?.granted, requestPermission]);

  const handlePickFromGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: IMAGE_QUALITY,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    const uri = result.assets[0].uri;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCameraActive(false);
    setCapturedImage(uri);
    setParseLoading(true);
    setParseError(null);
    setScannedData(null);
    setEditedData(null);
    try {
      const labelData = await parseLabelImage(uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setScannedData(labelData);
      setEditedData(labelData);
      if (labelData.servingsPerContainer) {
        setPortions(labelData.servingsPerContainer.toString());
        ocrPortionsRef.current = labelData.servingsPerContainer;
      } else {
        ocrPortionsRef.current = 1;
      }
    } catch (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      setParseError(
        error instanceof Error
          ? error.message.slice(0, 200)
          : "Failed to parse nutrition label. Try a clearer image.",
      );
    } finally {
      setParseLoading(false);
    }
  };

  const handleTakePicture = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: IMAGE_QUALITY,
        shutterSound: false,
      });

      if (photo?.uri) {
        // Haptic feedback on capture
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        setCameraActive(false);
        setCapturedImage(photo.uri);
        setParseLoading(true);
        setParseError(null);
        setScannedData(null);

        try {
          const labelData = await parseLabelImage(photo.uri);

          // Haptic feedback on success
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

          setScannedData(labelData);
          setEditedData(labelData);
          if (labelData.servingsPerContainer) {
            setPortions(labelData.servingsPerContainer.toString());
            ocrPortionsRef.current = labelData.servingsPerContainer;
          } else {
            ocrPortionsRef.current = 1;
          }
        } catch (error) {
          // Haptic feedback on error
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

          setParseError(
            error instanceof Error
              ? error.message
              : "Failed to parse nutrition label. Try a clearer photo.",
          );
          setCameraActive(false);
        } finally {
          setParseLoading(false);
        }
      }
    } catch (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setParseError("Failed to capture image. Please try again.");
    }
  };

  const handleRetake = () => {
    setCapturedImage(null);
    setScannedData(null);
    setEditedData(null);
    setParseError(null);
    setCameraActive(true);
  };

  const handleResetPortions = () => {
    setPortions(ocrPortionsRef.current.toString());
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleConfirm = () => {
    if (!editedData) return;
    const portionCount = parseFloat(portions) || 1;
    if (portionCount <= 0) {
      setParseError("Portions multiplier must be greater than 0");
      return;
    }
    onLabelScanned(editedData, portionCount);
    setCameraActive(true);
    setCapturedImage(null);
    setScannedData(null);
    setEditedData(null);
  };

  const portionValue = parseFloat(portions) || 1;

  const setField = <K extends keyof ScannedLabelData>(key: K, raw: string) => {
    setEditedData((prev) => {
      if (!prev) return prev;
      const numFields: (keyof ScannedLabelData)[] = [
        "calories",
        "protein",
        "carbs",
        "fat",
        "fibre",
        "servingsPerContainer",
      ];
      if (numFields.includes(key)) {
        // User edited a scaled value — reverse the multiplier to store per-serving
        const n = parseFloat(raw);
        const perServing = isNaN(n) ? 0 : n / portionValue;
        const rounded = ["calories"].includes(key as string)
          ? Math.round(perServing)
          : Math.round(perServing * 10) / 10;
        return { ...prev, [key]: rounded };
      }
      return { ...prev, [key]: raw };
    });
  };

  const portionDiffers = portionValue !== ocrPortionsRef.current;

  const macroMismatch = (() => {
    if (!editedData) return null;
    const macroKcal =
      editedData.protein * 4 + editedData.carbs * 4 + editedData.fat * 9;
    const rounded = Math.round(macroKcal);
    const delta = Math.round(editedData.calories - rounded);
    const tolerance = Math.round(editedData.calories * 0.12);
    if (Math.abs(delta) <= tolerance) return null;
    return { macroCalories: rounded, delta };
  })();

  // Display values = per-serving * multiplier
  const displayData = editedData
    ? {
        title: editedData.title,
        servingSize: editedData.servingSize,
        servingsPerContainer: editedData.servingsPerContainer,
        calories: Math.round(editedData.calories * portionValue),
        protein: Math.round(editedData.protein * portionValue * 10) / 10,
        carbs: Math.round(editedData.carbs * portionValue * 10) / 10,
        fat: Math.round(editedData.fat * portionValue * 10) / 10,
        fibre: Math.round(editedData.fibre * portionValue * 10) / 10,
      }
    : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      {cameraActive && permission?.granted ? (
        <View style={styles.container}>
          <View style={styles.cameraContainer}>
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing="back"
              autofocus="on"
            />
            <View style={styles.overlay}>
              <View
                style={[
                  styles.controlsWrapper,
                  { paddingBottom: insets.bottom },
                ]}
              >
                <View style={styles.controls}>
                  <Button
                    mode="outlined"
                    onPress={onClose}
                    style={styles.button}
                    textColor="white"
                    labelStyle={{ fontSize: 12 }}
                  >
                    Cancel
                  </Button>
                  <Button
                    mode="outlined"
                    onPress={handlePickFromGallery}
                    icon="image"
                    style={styles.button}
                    textColor="white"
                    labelStyle={{ fontSize: 12 }}
                  >
                    Gallery
                  </Button>
                  <Button
                    mode="contained"
                    onPress={handleTakePicture}
                    icon="camera"
                    style={[
                      styles.button,
                      { backgroundColor: theme.colors.primary },
                    ]}
                    labelStyle={{ fontSize: 12 }}
                  >
                    Scan
                  </Button>
                </View>
              </View>
            </View>
          </View>
        </View>
      ) : !permission?.granted ? (
        <View
          style={[
            styles.container,
            {
              justifyContent: "center",
              alignItems: "center",
              paddingHorizontal: 16,
            },
          ]}
        >
          <View
            style={[
              {
                backgroundColor: theme.colors.surface,
                borderRadius: 16,
                padding: 20,
                alignItems: "center",
              },
            ]}
          >
            <MaterialCommunityIcons
              name="camera"
              size={48}
              color={theme.colors.primary}
            />
            <Text
              variant="titleMedium"
              style={{ marginTop: 16, fontWeight: "700", textAlign: "center" }}
            >
              Camera Permission Required
            </Text>
            <Text
              variant="bodySmall"
              style={{
                marginTop: 8,
                textAlign: "center",
                color: theme.colors.onSurfaceVariant,
              }}
            >
              We need access to your camera to scan nutrition labels.
            </Text>
            <View
              style={{
                flexDirection: "row",
                gap: 8,
                marginTop: 24,
                width: "100%",
              }}
            >
              <Button mode="outlined" onPress={onClose} style={{ flex: 1 }}>
                Cancel
              </Button>
              <Button
                mode="contained"
                onPress={requestPermission}
                style={{ flex: 1 }}
              >
                Allow
              </Button>
            </View>
          </View>
        </View>
      ) : null}

      {/* Full-screen image viewer */}
      <Modal
        visible={fullImageVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setFullImageVisible(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "#000" }}
          onPress={() => setFullImageVisible(false)}
        >
          {capturedImage ? (
            <Image
              source={{ uri: capturedImage }}
              style={{ flex: 1, width: "100%", height: "100%" }}
              resizeMode="contain"
            />
          ) : null}
        </Pressable>
      </Modal>

      {capturedImage && !cameraActive ? (
        <Modal
          visible={!cameraActive}
          transparent
          animationType="fade"
          onRequestClose={handleRetake}
        >
          <View style={{ flex: 1, backgroundColor: "rgba(0, 0, 0, 0.5)" }}>
            <View style={[styles.previewModal, { paddingTop: insets.top }]}>
              <View
                style={[
                  styles.previewContent,
                  {
                    backgroundColor: theme.colors.surface,
                    paddingBottom: insets.bottom + 16,
                    flex: 1,
                  },
                ]}
              >
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <Text variant="titleMedium" style={{ fontWeight: "700" }}>
                    Nutrition Scan
                  </Text>
                  <Button
                    mode="text"
                    onPress={handleRetake}
                    compact
                    labelStyle={{ fontSize: 12 }}
                  >
                    Cancel
                  </Button>
                </View>

                <Pressable onPress={() => setFullImageVisible(true)}>
                  <Image
                    source={{ uri: capturedImage }}
                    style={styles.previewImage}
                  />
                </Pressable>

                {parseLoading ? (
                  <View style={{ alignItems: "center", paddingVertical: 24 }}>
                    <ActivityIndicator
                      size="large"
                      color={theme.colors.primary}
                    />
                    <Text
                      variant="bodySmall"
                      style={{
                        marginTop: 12,
                        color: theme.colors.onSurfaceVariant,
                      }}
                    >
                      Reading nutrition label...
                    </Text>
                  </View>
                ) : parseError ? (
                  <View
                    style={[
                      { padding: 12, borderRadius: 8, marginBottom: 12 },
                      {
                        backgroundColor: theme.colors.errorContainer,
                      },
                    ]}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <MaterialCommunityIcons
                        name="alert-circle"
                        size={20}
                        color={theme.colors.error}
                      />
                      <Text
                        variant="bodySmall"
                        style={{
                          flex: 1,
                          color: theme.colors.error,
                        }}
                      >
                        {parseError}
                      </Text>
                    </View>
                  </View>
                ) : scannedData ? (
                  <>
                    <ScrollView
                      showsVerticalScrollIndicator={true}
                      style={{ flex: 1 }}
                      contentContainerStyle={{ paddingBottom: 8 }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <TextInput
                          label="Product Name"
                          value={editedData?.title ?? ""}
                          onChangeText={(v) => setField("title", v)}
                          mode="outlined"
                          dense
                          theme={SCANNER_INPUT_THEME}
                          style={{ flex: 1 }}
                        />
                      </View>
                      <View
                        style={{
                          flexDirection: "row",
                          gap: 8,
                          marginBottom: 8,
                          alignItems: "flex-start",
                        }}
                      >
                        <TextInput
                          label="Serving Size"
                          value={editedData?.servingSize ?? ""}
                          onChangeText={(v) => setField("servingSize", v)}
                          mode="outlined"
                          dense
                          theme={SCANNER_INPUT_THEME}
                          style={{ flex: 1 }}
                        />
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 2,
                          }}
                        >
                          <TextInput
                            label="× Portions"
                            value={portions}
                            onChangeText={setPortions}
                            keyboardType="decimal-pad"
                            mode="outlined"
                            dense
                            placeholder="1"
                            theme={SCANNER_INPUT_THEME}
                            style={{ width: 100 }}
                          />
                          <Pressable
                            onPress={handleResetPortions}
                            style={{ padding: 6, marginTop: 6 }}
                            hitSlop={8}
                          >
                            <MaterialCommunityIcons
                              name="restore"
                              size={22}
                              color={theme.colors.primary}
                            />
                          </Pressable>
                        </View>
                      </View>

                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          marginTop: 8,
                          marginBottom: 4,
                        }}
                      >
                        <Text
                          variant="labelSmall"
                          style={{ color: theme.colors.onSurfaceVariant }}
                        >
                          Nutrition
                        </Text>
                        {portionDiffers && (
                          <View
                            style={{
                              backgroundColor: theme.colors.primaryContainer,
                              borderRadius: 4,
                              paddingHorizontal: 5,
                              paddingVertical: 1,
                            }}
                          >
                            <Text
                              variant="labelSmall"
                              style={{
                                color: theme.colors.onPrimaryContainer,
                                fontWeight: "600",
                                fontSize: 11,
                              }}
                            >
                              ×{portionValue}
                            </Text>
                          </View>
                        )}
                      </View>

                      <View
                        style={{
                          flexDirection: "row",
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <TextInput
                          label="Calories"
                          value={displayData?.calories?.toString() ?? ""}
                          onChangeText={(v) => setField("calories", v)}
                          keyboardType="decimal-pad"
                          mode="outlined"
                          dense
                          theme={SCANNER_INPUT_THEME}
                          style={{ flex: 1 }}
                        />
                        <TextInput
                          label="Protein (g)"
                          value={displayData?.protein?.toString() ?? ""}
                          onChangeText={(v) => setField("protein", v)}
                          keyboardType="decimal-pad"
                          mode="outlined"
                          dense
                          theme={SCANNER_INPUT_THEME}
                          style={{ flex: 1 }}
                        />
                      </View>
                      <View
                        style={{
                          flexDirection: "row",
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <TextInput
                          label="Carbs (g)"
                          value={displayData?.carbs?.toString() ?? ""}
                          onChangeText={(v) => setField("carbs", v)}
                          keyboardType="decimal-pad"
                          mode="outlined"
                          dense
                          theme={SCANNER_INPUT_THEME}
                          style={{ flex: 1 }}
                        />
                        <TextInput
                          label="Fat (g)"
                          value={displayData?.fat?.toString() ?? ""}
                          onChangeText={(v) => setField("fat", v)}
                          keyboardType="decimal-pad"
                          mode="outlined"
                          dense
                          theme={SCANNER_INPUT_THEME}
                          style={{ flex: 1 }}
                        />
                      </View>
                      <View
                        style={{
                          flexDirection: "row",
                          gap: 8,
                          marginBottom: 12,
                        }}
                      >
                        <TextInput
                          label="Fibre (g)"
                          value={displayData?.fibre?.toString() ?? ""}
                          onChangeText={(v) => setField("fibre", v)}
                          keyboardType="decimal-pad"
                          mode="outlined"
                          dense
                          theme={SCANNER_INPUT_THEME}
                          style={{ flex: 1 }}
                        />
                        <View style={{ flex: 1 }} />
                      </View>

                      {macroMismatch ? (
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 6,
                            backgroundColor: theme.colors.errorContainer,
                            borderRadius: 8,
                            padding: 10,
                            marginBottom: 10,
                          }}
                        >
                          <MaterialCommunityIcons
                            name="alert-circle-outline"
                            size={14}
                            color={theme.colors.error}
                          />
                          <Text
                            variant="bodySmall"
                            style={{ color: theme.colors.error, flex: 1 }}
                          >
                            Macros imply ~{macroMismatch.macroCalories} kcal,
                            which differs from the logged calories (
                            {macroMismatch.delta > 0 ? "−" : "+"}
                            {Math.abs(macroMismatch.delta)} kcal gap).
                          </Text>
                        </View>
                      ) : null}
                    </ScrollView>
                    <View
                      style={{
                        flexDirection: "row",
                        gap: 8,
                        marginTop: 8,
                      }}
                    >
                      <Button
                        mode="outlined"
                        onPress={handleRetake}
                        style={{ flex: 1 }}
                      >
                        Retake
                      </Button>
                      <Button
                        mode="contained"
                        onPress={handleConfirm}
                        style={{ flex: 1 }}
                      >
                        Add to Log
                      </Button>
                    </View>
                  </>
                ) : null}
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </Modal>
  );
}

import { useCallback, useState } from "react";
import { StyleSheet } from "react-native";
import { Button, Dialog, Portal, Text, useTheme } from "react-native-paper";

type AlertButton = {
  text: string;
  onPress?: () => void;
  style?: "cancel" | "destructive" | "default";
};

type AlertOptions = {
  title: string;
  message?: string;
  buttons?: AlertButton[];
};

/**
 * A thin hook over react-native-paper's Dialog + Portal.
 * Drop-in replacement for `Alert.alert(...)` with MD3 theming.
 *
 * Usage:
 *   const m3Alert = useM3Alert();
 *   // ...
 *   m3Alert.alert("Title", "Message", [{ text: "OK" }]);
 *   // ...
 *   {m3Alert.alertDialog}
 */
export function useM3Alert() {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  const [options, setOptions] = useState<AlertOptions>({
    title: "",
    message: undefined,
    buttons: [],
  });

  const alert = useCallback(
    (title: string, message?: string, buttons?: AlertButton[]) => {
      setOptions({ title, message: message ?? undefined, buttons });
      setVisible(true);
    },
    [],
  );

  const hide = useCallback(() => {
    setVisible(false);
  }, []);

  const alertDialog = (
    <Portal>
      <Dialog visible={visible} onDismiss={hide}>
        <Dialog.Title>{options.title}</Dialog.Title>
        {options.message ? (
          <Dialog.Content style={styles.content}>
            <Text variant="bodyMedium">{options.message}</Text>
          </Dialog.Content>
        ) : null}
        <Dialog.Actions style={styles.actions}>
          {!options.buttons || options.buttons.length === 0 ? (
            <Button onPress={hide}>OK</Button>
          ) : (
            options.buttons.map((btn, index) => {
              const isDestructive = btn.style === "destructive";
              const isCancel = btn.style === "cancel";
              return (
                <Button
                  key={index}
                  textColor={
                    isDestructive
                      ? theme.colors.error
                      : isCancel
                        ? theme.colors.onSurfaceVariant
                        : theme.colors.primary
                  }
                  onPress={() => {
                    hide();
                    btn.onPress?.();
                  }}
                >
                  {btn.text}
                </Button>
              );
            })
          )}
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );

  return { alert, alertDialog, hide };
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 4,
  },
  actions: {
    paddingTop: 0,
  },
});

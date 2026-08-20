import { Platform } from "react-native";
import Constants from "expo-constants";
import * as IntentLauncher from "expo-intent-launcher";
import * as Linking from "expo-linking";

const REQUEST_IGNORE_BATTERY_OPTIMIZATIONS =
  "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS";
const IGNORE_BATTERY_OPTIMIZATION_SETTINGS =
  "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS";

const packageName = () => Constants.expoConfig?.android?.package ?? "app.nanumhr";

export async function openBatteryOptimizationExemption() {
  if (Platform.OS !== "android") {
    await Linking.openSettings();
    return;
  }

  try {
    await IntentLauncher.startActivityAsync(REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, {
      data: `package:${packageName()}`,
    });
    return;
  } catch {
    // Some OEM ROMs block the direct dialog. The list screen is less precise, but
    // still gets the employee to the switch Android is willing to expose.
  }

  try {
    await IntentLauncher.startActivityAsync(IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
  } catch {
    await Linking.openSettings();
  }
}

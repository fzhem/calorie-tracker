package com.calorietracker.rnmemory;

import android.app.ActivityManager;
import android.content.Context;
import android.os.Debug;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

import java.io.RandomAccessFile;

public class RNMemoryModule extends ReactContextBaseJavaModule {

  RNMemoryModule(ReactApplicationContext context) {
    super(context);
  }

  @NonNull
  @Override
  public String getName() {
    return "RNMemoryModule";
  }

  @ReactMethod
  public void getMemoryUsage(Promise promise) {
    try {
      double nativeHeapBytes = Debug.getNativeHeapAllocatedSize();
      double residentBytes = readVmRSS();

      long availableMemoryBytes = 0;
      boolean isLowMemory = false;
      Context ctx = getReactApplicationContext();
      if (ctx != null) {
        ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
        if (am != null) {
          ActivityManager.MemoryInfo memInfo = new ActivityManager.MemoryInfo();
          am.getMemoryInfo(memInfo);
          availableMemoryBytes = memInfo.availMem;
          isLowMemory = memInfo.lowMemory;
        }
      }

      WritableMap result = Arguments.createMap();
      result.putDouble("nativeHeapBytes", nativeHeapBytes);
      result.putDouble("residentBytes", residentBytes);
      result.putDouble("availableMemoryBytes", (double) availableMemoryBytes);
      result.putBoolean("isLowMemory", isLowMemory);
      promise.resolve(result);
    } catch (Exception e) {
      promise.reject("MEMORY_ERROR", e.getMessage(), e);
    }
  }

  private double readVmRSS() {
    try (RandomAccessFile f = new RandomAccessFile("/proc/self/statm", "r")) {
      String line = f.readLine();
      if (line != null) {
        int firstSpace = line.indexOf(' ');
        if (firstSpace > 0) {
          int secondSpace = line.indexOf(' ', firstSpace + 1);
          String rssPages = secondSpace > 0
            ? line.substring(firstSpace + 1, secondSpace)
            : line.substring(firstSpace + 1);
          return Double.parseDouble(rssPages) * 4096;
        }
      }
    } catch (Exception ignored) {}
    return 0;
  }
}

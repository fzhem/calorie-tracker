package expo.modules.rnmemorymodule

import android.app.ActivityManager
import android.content.Context
import android.os.Debug
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RnMemoryModule : Module() {
  companion object {
    private const val TAG = "RnMemoryModule"
  }

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("App context lost")

  override fun definition() = ModuleDefinition {
    Name("RnMemoryModule")

    /**
     * Get the app's current native heap allocated size (bytes).
     *
     * Returns Double (not Long) to match LiteRT exactly and ensure proper
     * serialization through the Expo Modules bridge. Long values can silently
     * fail to serialize as JS numbers in Map<String, Any>.
     */
    Function("getNativeHeapBytes") {
      Debug.getNativeHeapAllocatedSize().toDouble()
    }

    /**
     * Get the app's current resident set size (RSS) in bytes.
     * Reads from /proc/self/status VmRSS — the same approach LiteRT uses.
     */
    Function("getResidentBytes") {
      getRssFromProc()
    }

    /**
     * Get available system memory in bytes.
     * Uses ActivityManager.MemoryInfo.availMem.
     */
    Function("getAvailableMemoryBytes") {
      getAvailableMemory()
    }

    /**
     * Get total system memory in bytes.
     * Uses ActivityManager.MemoryInfo.totalMem.
     */
    Function("getTotalMemoryBytes") {
      getTotalMemory()
    }

    /**
     * Check if the system considers memory low.
     * Uses ActivityManager.MemoryInfo.lowMemory.
     */
    Function("isLowMemory") {
      isLowMemoryState()
    }

    /**
     * Get all memory stats in one call (avoids multiple JNI crossings).
     *
     * All numeric values are returned as Double to match LiteRT's
     * MemoryUsage struct exactly and ensure proper Expo Modules serialization.
     */
    Function("getMemoryStats") {
      val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      var availMem = 0.0
      var totalMem = 0.0
      var lowMemory = false

      if (activityManager != null) {
        try {
          val memoryInfo = ActivityManager.MemoryInfo()
          activityManager.getMemoryInfo(memoryInfo)
          availMem = memoryInfo.availMem.toDouble()
          totalMem = memoryInfo.totalMem.toDouble()
          lowMemory = memoryInfo.lowMemory
        } catch (e: Exception) {
          Log.w(TAG, "Failed to get ActivityManager memory info: ${e.message}")
        }
      }

      return@Function mapOf(
        "nativeHeapBytes" to Debug.getNativeHeapAllocatedSize().toDouble(),
        "residentBytes" to getRssFromProc(),
        "availableMemoryBytes" to availMem,
        "totalMemoryBytes" to totalMem,
        "isLowMemory" to lowMemory
      )
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers — mirror LiteRT's HybridLiteRTLM.getMemoryUsage() exactly
  // -------------------------------------------------------------------------

  /**
   * Read RSS from /proc/self/status (VmRSS) in kB, convert to bytes.
   *
   * Uses the same line-by-line parsing approach as LiteRT:
   *   java.io.File("/proc/self/status").forEachLine { ... }
   */
  private fun getRssFromProc(): Double {
    var residentBytes = 0.0
    try {
      java.io.File("/proc/self/status").forEachLine { line ->
        if (line.startsWith("VmRSS:")) {
          val kb = line.substringAfter("VmRSS:").trim().split("\\s+".toRegex())[0].toDoubleOrNull()
          if (kb != null) {
            residentBytes = kb * 1024.0
          }
          return@forEachLine
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "Failed to read /proc/self/status: ${e.message}")
    }
    return residentBytes
  }

  private fun getAvailableMemory(): Double {
    val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      ?: return 0.0
    return try {
      val memoryInfo = ActivityManager.MemoryInfo()
      activityManager.getMemoryInfo(memoryInfo)
      memoryInfo.availMem.toDouble()
    } catch (e: Exception) {
      Log.w(TAG, "Failed to get available memory: ${e.message}")
      0.0
    }
  }

  private fun getTotalMemory(): Double {
    val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      ?: return 0.0
    return try {
      val memoryInfo = ActivityManager.MemoryInfo()
      activityManager.getMemoryInfo(memoryInfo)
      memoryInfo.totalMem.toDouble()
    } catch (e: Exception) {
      Log.w(TAG, "Failed to get total memory: ${e.message}")
      0.0
    }
  }

  private fun isLowMemoryState(): Boolean {
    val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      ?: return false
    return try {
      val memoryInfo = ActivityManager.MemoryInfo()
      activityManager.getMemoryInfo(memoryInfo)
      memoryInfo.lowMemory
    } catch (e: Exception) {
      Log.w(TAG, "Failed to get low memory state: ${e.message}")
      false
    }
  }
}
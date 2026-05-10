module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: "./android",
        packageImportPath: "import com.calorietracker.rnmemory.RNMemoryPackage;",
        packageInstance: "new RNMemoryPackage()",
      },
    },
  },
};

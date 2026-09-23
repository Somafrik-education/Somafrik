/** Local AAB signing with the existing EAS upload key. Never commit credentials. */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const EXPECTED = "2EE5C0F3598833E33B135DCC018905E012F21EACC0AF391103E18CEB5D3FEF53";
function configureUploadSigning(androidDir) {
  const propsPath = process.env.SOMAFRIK_UPLOAD_PROPERTIES;
  if (!propsPath || !path.isAbsolute(propsPath) || !fs.existsSync(propsPath)) throw new Error("HOLD: SOMAFRIK_UPLOAD_PROPERTIES must point to a private absolute file path.");
  const props = fs.readFileSync(propsPath, "utf8");
  for (const key of ["storeFile", "storePassword", "keyAlias", "keyPassword"]) {
    if (!new RegExp("^\\s*" + key + "\\s*=\\s*\\S+", "m").test(props)) throw new Error("HOLD: missing signing property: " + key);
  }
  const gradlePath = path.join(androidDir, "app", "build.gradle");
  let gradle = fs.readFileSync(gradlePath, "utf8");
  if (gradle.includes("SOMAFRIK_EAS_UPLOAD_SIGNING")) throw new Error("HOLD: signing already injected.");
  gradle += `
// SOMAFRIK_EAS_UPLOAD_SIGNING — generated after expo prebuild --clean.
def somafrikUploadProps = new Properties()
def somafrikUploadFile = new File(System.getenv("SOMAFRIK_UPLOAD_PROPERTIES"))
somafrikUploadFile.withInputStream { somafrikUploadProps.load(it) }
android {
  signingConfigs {
    easUpload {
      storeFile file(somafrikUploadProps.getProperty("storeFile"))
      storePassword somafrikUploadProps.getProperty("storePassword")
      keyAlias somafrikUploadProps.getProperty("keyAlias")
      keyPassword somafrikUploadProps.getProperty("keyPassword")
    }
  }
  buildTypes { release { signingConfig signingConfigs.easUpload } }
}
`;
  fs.writeFileSync(gradlePath, gradle, "utf8");
  console.log("Local EAS upload signing configured (no secrets printed).");
}
function verifySignedBundle(aabPath) {
  const jar = spawnSync("jarsigner", ["-verify", aabPath], { encoding: "utf8" });
  if (jar.error || jar.status !== 0 || !/jar verified/i.test((jar.stdout || "") + (jar.stderr || ""))) throw new Error("HOLD: jarsigner verification failed.");
  const cert = spawnSync("keytool", ["-printcert", "-jarfile", aabPath], { encoding: "utf8" });
  const output = (cert.stdout || "") + (cert.stderr || "");
  const hashes = [...output.matchAll(/SHA[\s-]*256\s*:\s*([0-9a-f:]{64,95})/gi)].map(m => m[1].replace(/:/g, "").toUpperCase());
  if (cert.error || cert.status !== 0 || !hashes.includes(EXPECTED)) throw new Error("HOLD: AAB certificate does not match Google Play upload certificate.");
  console.log("AAB signed with verified EAS/Google Play upload certificate.");
}
module.exports = { configureUploadSigning, verifySignedBundle };

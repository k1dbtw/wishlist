import com.android.apksig.ApkSigner;
import java.io.*;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.*;
import java.util.zip.*;

/**
 * Pack.java <resources.apk> <classes.dex> <keystore.p12> <password> <out.apk>
 * Adds classes.dex to the aapt2 output, stores resources.arsc uncompressed on a
 * 4-byte boundary (required from Android 11 for targetSdk 30+), then signs with APK Signature Scheme v2.
 */
public class Pack {
    public static void main(String[] a) throws Exception {
        File res = new File(a[0]), dex = new File(a[1]), ks = new File(a[2]), out = new File(a[4]);
        char[] pass = a[3].toCharArray();
        File unsigned = File.createTempFile("stash", ".apk");

        try (ZipFile in = new ZipFile(res);
             CountingStream cs = new CountingStream(new BufferedOutputStream(new FileOutputStream(unsigned)));
             ZipOutputStream zo = new ZipOutputStream(cs)) {
            List<String> names = new ArrayList<>();
            for (Enumeration<? extends ZipEntry> e = in.entries(); e.hasMoreElements(); ) names.add(e.nextElement().getName());
            names.add("classes.dex");
            for (String name : names) {
                byte[] data = name.equals("classes.dex") ? readAll(new FileInputStream(dex)) : readAll(in.getInputStream(in.getEntry(name)));
                ZipEntry z = new ZipEntry(name);
                z.setTime(315532800000L + 86400000L * 366);  // fixed timestamp: reproducible builds
                boolean store = name.equals("resources.arsc") || name.endsWith(".png");
                if (store) {
                    CRC32 crc = new CRC32(); crc.update(data);
                    z.setMethod(ZipEntry.STORED); z.setSize(data.length); z.setCompressedSize(data.length); z.setCrc(crc.getValue());
                    long headerEnd = cs.count + 30 + name.getBytes("UTF-8").length;
                    int pad = (int) ((4 - headerEnd % 4) % 4);
                    if (pad > 0) z.setExtra(new byte[pad]);  // zero padding, the same trick zipalign uses
                } else {
                    z.setMethod(ZipEntry.DEFLATED);
                }
                zo.putNextEntry(z);
                zo.write(data);
                zo.closeEntry();
                zo.flush();
            }
        }

        KeyStore store = KeyStore.getInstance("PKCS12");
        try (InputStream is = new FileInputStream(ks)) { store.load(is, pass); }
        String alias = store.aliases().nextElement();
        PrivateKey key = (PrivateKey) store.getKey(alias, pass);
        X509Certificate cert = (X509Certificate) store.getCertificate(alias);
        ApkSigner.SignerConfig signer = new ApkSigner.SignerConfig.Builder("stash", key, Collections.singletonList(cert)).build();
        new ApkSigner.Builder(Collections.singletonList(signer))
            .setInputApk(unsigned).setOutputApk(out)
            // v2 only: the v1 (JAR) signer in apksig 2.3.0 calls a JDK internal that no longer exists,
            // and v2 is all Android 7.0+ (minSdk 24) needs
            .setV1SigningEnabled(false).setV2SigningEnabled(true).setMinSdkVersion(24)
            .build().sign();
        unsigned.delete();
    }

    static byte[] readAll(InputStream is) throws IOException {
        try (InputStream s = is) { ByteArrayOutputStream b = new ByteArrayOutputStream(); byte[] buf = new byte[65536]; int n; while ((n = s.read(buf)) > 0) b.write(buf, 0, n); return b.toByteArray(); }
    }

    static class CountingStream extends FilterOutputStream {
        long count;
        CountingStream(OutputStream o) { super(o); }
        @Override public void write(int b) throws IOException { out.write(b); count++; }
        @Override public void write(byte[] b, int off, int len) throws IOException { out.write(b, off, len); count += len; }
    }
}

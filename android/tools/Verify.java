import com.android.apksig.ApkVerifier;
import java.io.File;
import java.util.zip.*;
import java.io.RandomAccessFile;

/** Verify.java <apk>: checks both signature schemes and that resources.arsc is stored and 4-byte aligned. */
public class Verify {
    public static void main(String[] a) throws Exception {
        ApkVerifier.Result r = new ApkVerifier.Builder(new File(a[0])).build().verify();
        System.out.println("verified=" + r.isVerified() + " v1=" + r.isVerifiedUsingV1Scheme() + " v2=" + r.isVerifiedUsingV2Scheme());
        for (ApkVerifier.IssueWithParams e : r.getErrors()) System.out.println("error: " + e);
        try (ZipFile z = new ZipFile(a[0]); RandomAccessFile f = new RandomAccessFile(a[0], "r")) {
            ZipEntry e = z.getEntry("resources.arsc");
            // find the local header by scanning for the name; data starts after 30 + name + extra
            byte[] all = new byte[(int) f.length()]; f.readFully(all);
            for (int i = 0; i < all.length - 4; i++) {
                if (all[i] == 0x50 && all[i + 1] == 0x4b && all[i + 2] == 3 && all[i + 3] == 4) {
                    int nlen = (all[i + 26] & 0xff) | (all[i + 27] & 0xff) << 8, xlen = (all[i + 28] & 0xff) | (all[i + 29] & 0xff) << 8;
                    String name = new String(all, i + 30, nlen, "UTF-8");
                    if (name.equals("resources.arsc")) {
                        long off = i + 30 + nlen + xlen;
                        System.out.println("resources.arsc method=" + (e.getMethod() == 0 ? "stored" : "deflated") + " offset%4=" + (off % 4));
                        break;
                    }
                }
            }
        }
        if (!r.isVerified()) System.exit(1);
    }
}

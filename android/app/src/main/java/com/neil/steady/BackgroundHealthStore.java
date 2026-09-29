package com.neil.steady;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Background credentials and activity never enter backups or unencrypted preferences. */
final class BackgroundHealthStore {
    static final Object LOCK = new Object();
    private static final String ALIAS = "steady-background-health-v1";
    private static AtomicFile file(Context context) { return new AtomicFile(new File(context.getNoBackupFilesDir(), "background-health.enc")); }
    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    static JSONObject read(Context context) throws Exception {
        synchronized (LOCK) {
            AtomicFile f = file(context); if (!f.getBaseFile().exists()) return new JSONObject();
            JSONObject wrapper = new JSONObject(new String(f.readFully(), StandardCharsets.UTF_8));
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(wrapper.getString("iv"), Base64.NO_WRAP)));
            return new JSONObject(new String(cipher.doFinal(Base64.decode(wrapper.getString("data"), Base64.NO_WRAP)), StandardCharsets.UTF_8));
        }
    }
    static void write(Context context, JSONObject value) throws Exception {
        synchronized (LOCK) {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
            JSONObject wrapper = new JSONObject().put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .put("data", Base64.encodeToString(cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP));
            AtomicFile f = file(context); FileOutputStream stream = f.startWrite();
            try { stream.write(wrapper.toString().getBytes(StandardCharsets.UTF_8)); f.finishWrite(stream); }
            catch (Exception e) { f.failWrite(stream); throw e; }
        }
    }
    static void clear(Context context) { synchronized (LOCK) { file(context).delete(); } }
}

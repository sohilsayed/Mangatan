package com.mangatan.app;

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.util.Base64;
import android.util.Log;
import androidx.core.content.FileProvider;

import com.ichi2.anki.FlashCardsContract;
import com.ichi2.anki.api.AddContentApi;
import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.io.File;
import java.io.FileOutputStream;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class AnkiBridge {
    private static final String TAG = "MangatanAnki";
    private static final Uri NOTES_URI = Uri.parse("content://com.ichi2.anki.flashcards/notes");
    
    private Context context;
    private AddContentApi api;
    private Gson gson;

    public AnkiBridge(Context context) {
        this.context = context;
        this.api = new AddContentApi(context);
        this.gson = new Gson();
    }

    public String handleRequest(String jsonPayload) {
        try {
            JsonObject req = gson.fromJson(jsonPayload, JsonObject.class);
            if (!req.has("action")) return formatError("Missing action");

            String action = req.get("action").getAsString();
            JsonObject params = req.getAsJsonObject("params");
            Object val = null;

            switch (action) {
                // --- HANDSHAKE ---
                case "requestPermission":
                    return formatSuccess(Collections.singletonMap("permission", "granted"));

                // --- INFO ---
                case "version": val = 6; break;
                case "deckNames": val = api.getDeckList().values(); break;
                case "modelNames": val = api.getModelList(0).values(); break;
                case "modelFieldNames": val = handleModelFieldNames(params); break;

                // --- SEARCH (Crucial for anki.ts duplicate check & getLastCardId) ---
                case "findNotes":
                    val = handleFindNotes(params);
                    break;

                // --- GUI ---
                case "guiBrowse":
                    val = handleGuiBrowse(params);
                    break;

                // --- ADDITION ---
                case "canAddNotes":
                    val = handleCanAddNotes(params);
                    break;
                case "addNote": 
                    val = addNote(params.getAsJsonObject("note")); 
                    break;

                // --- UPDATES (Crucial for adding screenshots to existing cards) ---
                case "updateNoteFields":
                    handleUpdateNoteFields(params.getAsJsonObject("note"));
                    val = null; // Success = null result in AnkiConnect
                    break;

                // --- MEDIA ---
                case "storeMediaFile":
                    val = storeMediaFileFromParams(params);
                    break;

                case "multi":
                    return handleMulti(req);

                default: 
                    return formatSuccess(null); 
            }
            
            return formatSuccess(val);
        } catch (Exception e) {
            Log.e(TAG, "Bridge Error", e);
            return formatError(e.toString());
        }
    }

    // =================================================================
    // 1. COMPLEX SEARCH LOGIC (Matches anki.ts usage)
    // =================================================================

    private List<Long> handleFindNotes(JsonObject params) {
        String query = params.get("query").getAsString();
        List<Long> ids = new ArrayList<>();

        // Case A: anki.ts calling getLastCardId("added:1")
        if (query.contains("added:1")) {
            // We want the most recent note ID
            try (Cursor c = context.getContentResolver().query(
                    NOTES_URI, 
                    new String[]{"_id"}, 
                    null, // No selection
                    null, 
                    "_id DESC LIMIT 1")) { // Sort by ID desc
                if (c != null && c.moveToFirst()) {
                    ids.add(c.getLong(0));
                }
            }
            return ids;
        }

        // Case B: Duplicate check 'deck:"Deck" "Field:Value"'
        // We parse out the Field:Value to calculate the checksum
        Pattern fieldPattern = Pattern.compile("\"(.*?):(.*?)\"");
        Matcher m = fieldPattern.matcher(query);
        
        while (m.find()) {
            // Group 2 is the value. We calculate Anki's checksum for it.
            String value = m.group(2);
            long checksum = AnkiUtils.getFieldChecksum(value);
            
            try (Cursor c = context.getContentResolver().query(
                    NOTES_URI, new String[]{"_id"}, "csum = ?", 
                    new String[]{String.valueOf(checksum)}, null)) {
                if (c != null && c.moveToFirst()) {
                    do { ids.add(c.getLong(0)); } while (c.moveToNext());
                }
            }
        }
        
        return ids;
    }

    // =================================================================
    // 2. UPDATE LOGIC (Matches anki.ts updateLastCard)
    // =================================================================

    private void handleUpdateNoteFields(JsonObject note) throws Exception {
        long noteId = note.get("id").getAsLong();
        JsonObject fieldsJson = note.getAsJsonObject("fields");
        
        // 1. Get current fields from AnkiDroid (We need to merge, not overwrite empty ones)
        // AddContentApi doesn't expose getNote(id), but we can query by ID via ContentProvider
        // However, updating via API requires the full list of fields in order.
        
        Long modelId = getNoteModelId(noteId);
        if (modelId == null) throw new Exception("Note " + noteId + " not found");
        
        String[] fieldNames = api.getFieldList(modelId);
        if (fieldNames == null) throw new Exception("Model fields not found");

        // We can't easily READ the existing values via the public API or ContentProvider safely without Permissions complications.
        // STRATEGY: We assume the user wants to update specific fields (like Image/Sentence).
        // Since we can't read the old values easily to merge, we will use the api.updateNoteFields
        // but we must acknowledge this limitation: 
        // In this implementation, if you update a field, you must provide ALL fields or others might become empty.
        // HOWEVER: anki.ts updateLastCard usually only sends the image field. 
        // To support this fully, we would need to read the `flds` column from the DB, split by 0x1f, and merge.
        
        // Let's try to read the current fields to do a proper merge
        String[] currentValues = getCurrentNoteFields(noteId);
        if (currentValues == null || currentValues.length != fieldNames.length) {
            // Fallback: Create empty array if read fails
            currentValues = new String[fieldNames.length];
            Arrays.fill(currentValues, "");
        }

        // 2. Merge new values
        for (int i = 0; i < fieldNames.length; i++) {
            String name = fieldNames[i];
            if (fieldsJson.has(name)) {
                currentValues[i] = fieldsJson.get(name).getAsString();
            }
        }

        // 3. Process Media into the fields
        if (note.has("picture")) processMediaArray(currentValues, fieldNames, note.get("picture"), false);
        if (note.has("audio")) processMediaArray(currentValues, fieldNames, note.get("audio"), true);

        // 4. Save
        api.updateNoteFields(noteId, currentValues);
    }

    private String[] getCurrentNoteFields(long noteId) {
        try (Cursor c = context.getContentResolver().query(
                Uri.withAppendedPath(NOTES_URI, String.valueOf(noteId)),
                new String[]{"flds"}, 
                null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String rawFlds = c.getString(0);
                // Anki separates fields with Unit Separator (0x1f)
                return rawFlds.split("\u001f", -1); // -1 to keep trailing empty strings
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to read existing note fields", e);
        }
        return null;
    }

    private Long getNoteModelId(long noteId) {
        try (Cursor c = context.getContentResolver().query(
                Uri.withAppendedPath(NOTES_URI, String.valueOf(noteId)),
                new String[]{"mid"}, 
                null, null, null)) {
            if (c != null && c.moveToFirst()) {
                return c.getLong(0);
            }
        }
        return null;
    }

    // =================================================================
    // 3. ADD LOGIC & MEDIA
    // =================================================================

    private Long addNote(JsonObject note) throws Exception {
        String deckName = note.get("deckName").getAsString();
        String modelName = note.get("modelName").getAsString();
        JsonObject fieldsJson = note.getAsJsonObject("fields");
        
        long deckId = findId(api.getDeckList(), deckName);
        if (deckId == -1) deckId = api.addNewDeck(deckName);

        long modelId = findId(api.getModelList(0), modelName);
        if (modelId == -1) throw new Exception("Model not found");

        String[] fieldNames = api.getFieldList(modelId);
        String[] values = new String[fieldNames.length];
        
        for (int i = 0; i < fieldNames.length; i++) {
            String fName = fieldNames[i];
            values[i] = fieldsJson.has(fName) ? fieldsJson.get(fName).getAsString() : "";
        }

        if (note.has("picture")) processMediaArray(values, fieldNames, note.get("picture"), false);
        if (note.has("audio")) processMediaArray(values, fieldNames, note.get("audio"), true);

        Set<String> tags = new HashSet<>();
        if(note.has("tags")) {
            for(JsonElement t : note.getAsJsonArray("tags")) tags.add(t.getAsString());
        }

        return api.addNote(modelId, deckId, values, tags);
    }

    private void processMediaArray(String[] values, String[] fieldNames, JsonElement mediaElement, boolean isAudio) {
        JsonArray list = mediaElement.isJsonArray() ? mediaElement.getAsJsonArray() : new JsonArray();
        if (!mediaElement.isJsonArray()) list.add(mediaElement.getAsJsonObject());

        for (JsonElement el : list) {
            JsonObject m = el.getAsJsonObject();
            if (!m.has("fields") || !m.has("filename") || !m.has("data")) continue;

            String filename = m.get("filename").getAsString();
            String dataStr = m.get("data").getAsString();
            JsonArray targetFields = m.getAsJsonArray("fields");

            try {
                String storedName = storeMediaFile(filename, dataStr);
                String tag = isAudio ? "[sound:" + storedName + "]" : "<img src=\"" + storedName + "\">";

                for (JsonElement f : targetFields) {
                    String targetName = f.getAsString();
                    for (int i = 0; i < fieldNames.length; i++) {
                        if (fieldNames[i].equals(targetName)) {
                            values[i] = values[i] + tag;
                        }
                    }
                }
            } catch (Exception e) { Log.e(TAG, "Media Error", e); }
        }
    }

    private String storeMediaFile(String filename, String base64Data) throws Exception {
        byte[] data = Base64.decode(base64Data, Base64.DEFAULT);
        File file = new File(context.getCacheDir(), filename); 
        try (FileOutputStream fos = new FileOutputStream(file)) { fos.write(data); }

        Uri fileUri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
        context.grantUriPermission("com.ichi2.anki", fileUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);

        ContentValues values = new ContentValues();
        values.put(FlashCardsContract.AnkiMedia.FILE_URI, fileUri.toString());
        values.put(FlashCardsContract.AnkiMedia.PREFERRED_NAME, filename);

        Uri res = context.getContentResolver().insert(FlashCardsContract.AnkiMedia.CONTENT_URI, values);
        return res != null ? new File(res.getPath()).getName() : filename;
    }

    private String storeMediaFileFromParams(JsonObject params) {
        try { return storeMediaFile(params.get("filename").getAsString(), params.get("data").getAsString()); } 
        catch (Exception e) { return null; }
    }

    // =================================================================
    // 4. HELPERS
    // =================================================================

    private List<Boolean> handleCanAddNotes(JsonObject req) {
        JsonArray notes = req.getAsJsonObject("params").getAsJsonArray("notes");
        List<Boolean> results = new ArrayList<>();
        for (JsonElement n : notes) {
            JsonObject note = n.getAsJsonObject();
            // Try to find the first field content to checksum it
            String firstField = null;
            try {
                String mName = note.get("modelName").getAsString();
                Long mId = findId(api.getModelList(0), mName);
                if (mId != -1) {
                    String[] fNames = api.getFieldList(mId);
                    if (fNames != null && fNames.length > 0 && note.getAsJsonObject("fields").has(fNames[0])) {
                        firstField = note.getAsJsonObject("fields").get(fNames[0]).getAsString();
                    }
                }
            } catch (Exception e) {}

            if (firstField == null) { results.add(true); continue; }

            long checksum = AnkiUtils.getFieldChecksum(firstField);
            boolean exists = false;
            try (Cursor c = context.getContentResolver().query(NOTES_URI, new String[]{"_id"}, "csum = ?", new String[]{String.valueOf(checksum)}, null)) {
                if (c != null && c.getCount() > 0) exists = true;
            }
            results.add(!exists);
        }
        return results;
    }

    private Collection<String> handleModelFieldNames(JsonObject req) {
        String modelName = req.getAsJsonObject("params").get("modelName").getAsString();
        Long modelId = findId(api.getModelList(0), modelName);
        return (modelId != -1) ? Arrays.asList(api.getFieldList(modelId)) : Collections.emptyList();
    }

    private boolean handleGuiBrowse(JsonObject req) {
        try {
            String query = req.getAsJsonObject("params").get("query").getAsString();
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("anki://x-callback-url/browser?search=" + query));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return true;
        } catch (Exception e) { return false; }
    }

    private String handleMulti(JsonObject req) {
        JsonArray actions = req.getAsJsonObject("params").getAsJsonArray("actions");
        JsonArray results = new JsonArray();
        for(JsonElement a : actions) {
            String res = handleRequest(gson.toJson(a));
            results.add(gson.fromJson(res, JsonObject.class));
        }
        return gson.toJson(results);
    }

    private long findId(Map<Long, String> map, String name) {
        if (map == null) return -1;
        for (Map.Entry<Long, String> e : map.entrySet()) {
            if (e.getValue().equalsIgnoreCase(name)) return e.getKey();
        }
        return -1;
    }

    private String formatSuccess(Object result) {
        Map<String, Object> map = new HashMap<>();
        map.put("result", result);
        map.put("error", null);
        return gson.toJson(map);
    }

    private String formatError(String err) {
        Map<String, Object> map = new HashMap<>();
        map.put("result", null);
        map.put("error", err);
        return gson.toJson(map);
    }

    // --- STATIC CHECKSUM UTILS ---
    private static class AnkiUtils {
        private static final Pattern STYLE = Pattern.compile("(?s)<style.*?>.*?</style>");
        private static final Pattern SCRIPT = Pattern.compile("(?s)<script.*?>.*?</script>");
        private static final Pattern TAGS = Pattern.compile("<.*?>");
        private static final Pattern IMG = Pattern.compile("<img src=[\"']?([^\"'>]+)[\"']? ?/?>");

        public static long getFieldChecksum(String data) {
            String s = stripHTMLMedia(data);
            try {
                MessageDigest md = MessageDigest.getInstance("SHA1");
                byte[] digest = md.digest(s.getBytes(StandardCharsets.UTF_8));
                BigInteger bigInt = new BigInteger(1, digest);
                String hash = bigInt.toString(16);
                while (hash.length() < 40) hash = "0" + hash;
                return Long.parseLong(hash.substring(0, 8), 16);
            } catch (Exception e) { return 0; }
        }

        private static String stripHTMLMedia(String s) {
            return stripHTML(IMG.matcher(s).replaceAll(" $1 "));
        }

        private static String stripHTML(String s) {
            String res = STYLE.matcher(s).replaceAll("");
            res = SCRIPT.matcher(res).replaceAll("");
            res = TAGS.matcher(res).replaceAll("");
            return res.replace("&nbsp;", " ").trim();
        }
    }
}
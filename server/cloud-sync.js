/**
 * ========================================================================
 * IELTS Ms Nga - Cloud Persistence & Sync Engine (Supabase / Render)
 * Automatically syncs local SQLite database snapshot & uploaded chart images
 * with Supabase Cloud Storage (100% Free - 1GB Storage)
 * ========================================================================
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const BUCKET_NAME = process.env.SUPABASE_BUCKET || 'ielts-classroom-data';

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false }
    });
    console.log('[CloudSync] Đã kết nối Supabase Client thành công.');
  } catch (err) {
    console.warn('[CloudSync] Không thể khởi tạo Supabase Client:', err.message);
  }
}

let syncTimeout = null;
let isSyncing = false;
let pendingSync = false;

/**
 * Ensure storage bucket exists
 */
async function ensureBucketExists() {
  if (!supabase) return false;
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) {
      console.warn('[CloudSync] Không thể liệt kê buckets:', error.message);
      return false;
    }
    const exists = buckets.some((b) => b.name === BUCKET_NAME);
    if (!exists) {
      const { error: createErr } = await supabase.storage.createBucket(BUCKET_NAME, {
        public: true
      });
      if (createErr) {
        console.warn('[CloudSync] Không thể tạo bucket:', createErr.message);
        return false;
      }
      console.log(`[CloudSync] Đã tạo mới bucket lưu trữ đám mây: ${BUCKET_NAME}`);
    }
    return true;
  } catch (e) {
    console.warn('[CloudSync] Lỗi kiểm tra bucket:', e.message);
    return false;
  }
}

/**
 * Download latest database and uploads from Supabase on startup
 */
async function pullFromCloud(dbFilePath, uploadsDir) {
  if (!supabase) {
    console.log('[CloudSync] Chế độ lưu trữ cục bộ (chưa cấu hình SUPABASE_URL).');
    return false;
  }

  try {
    await ensureBucketExists();

    // 1. Download database file
    console.log('[CloudSync] Đang kiểm tra cơ sở dữ liệu trên Supabase Cloud Storage...');
    const { data: dbBlob, error: dbErr } = await supabase.storage
      .from(BUCKET_NAME)
      .download('classroom.db');

    if (!dbErr && dbBlob) {
      const arrayBuffer = await dbBlob.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (buffer.length > 0) {
        fs.writeFileSync(dbFilePath, buffer);
        console.log(`[CloudSync] ✅ Đã tải và phục hồi classroom.db (${buffer.length} bytes) từ đám mây!`);
      }
    } else {
      console.log('[CloudSync] Chưa có bản sao lưu trên đám mây. Sẽ sử dụng dữ liệu khởi tạo ban đầu.');
    }

    // 2. Download uploaded chart images
    if (uploadsDir && fs.existsSync(uploadsDir)) {
      const { data: fileList, error: listErr } = await supabase.storage
        .from(BUCKET_NAME)
        .list('uploads');

      if (!listErr && Array.isArray(fileList) && fileList.length > 0) {
        for (const item of fileList) {
          if (!item.name) continue;
          const localPath = path.join(uploadsDir, item.name);
          if (!fs.existsSync(localPath)) {
            const { data: imgBlob } = await supabase.storage
              .from(BUCKET_NAME)
              .download(`uploads/${item.name}`);
            if (imgBlob) {
              const imgBuf = Buffer.from(await imgBlob.arrayBuffer());
              fs.writeFileSync(localPath, imgBuf);
              console.log(`[CloudSync] Đã tải ảnh biểu đồ: ${item.name}`);
            }
          }
        }
      }
    }

    return true;
  } catch (err) {
    console.warn('[CloudSync] Lỗi khi đồng bộ từ đám mây:', err.message);
    return false;
  }
}

/**
 * Push database and new uploads to Supabase Cloud Storage
 */
async function pushToCloud(dbFilePath, uploadsDir) {
  if (!supabase) return false;
  if (isSyncing) {
    pendingSync = true;
    return;
  }

  isSyncing = true;
  try {
    // 1. Upload classroom.db
    if (fs.existsSync(dbFilePath)) {
      const fileBuffer = fs.readFileSync(dbFilePath);
      const { error: upErr } = await supabase.storage
        .from(BUCKET_NAME)
        .upload('classroom.db', fileBuffer, {
          upsert: true,
          contentType: 'application/x-sqlite3'
        });

      if (upErr) {
        console.warn('[CloudSync] Lỗi tải lên database:', upErr.message);
      } else {
        console.log(`[CloudSync] ☁️ Đã sao lưu an toàn classroom.db (${fileBuffer.length} bytes) lên Supabase!`);
      }
    }

    // 2. Upload any new chart images
    if (uploadsDir && fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      for (const f of files) {
        const fullPath = path.join(uploadsDir, f);
        if (fs.statSync(fullPath).isFile()) {
          const content = fs.readFileSync(fullPath);
          const ext = path.extname(f).toLowerCase();
          const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.png' ? 'image/png' : 'image/jpeg';
          await supabase.storage
            .from(BUCKET_NAME)
            .upload(`uploads/${f}`, content, {
              upsert: true,
              contentType: mime
            });
        }
      }
    }
  } catch (e) {
    console.warn('[CloudSync] Ngoại lệ khi sao lưu lên đám mây:', e.message);
  } finally {
    isSyncing = false;
    if (pendingSync) {
      pendingSync = false;
      pushToCloud(dbFilePath, uploadsDir);
    }
  }
}

/**
 * Schedule a debounced upload
 */
function scheduleCloudSync(dbFilePath, uploadsDir, delayMs = 5000) {
  if (!supabase) return;
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    pushToCloud(dbFilePath, uploadsDir).catch((e) => {
      console.warn('[CloudSync] Lỗi tiến trình nền:', e.message);
    });
  }, delayMs);
}

/**
 * Check cloud status for system readiness check
 */
async function checkCloudStatus() {
  if (!supabase) {
    return {
      configured: false,
      status: 'LOCAL_STANDALONE',
      detail: 'Hệ thống đang hoạt động với cơ sở dữ liệu cục bộ SQLite trên máy chủ'
    };
  }

  try {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) {
      return {
        configured: true,
        status: 'ERROR',
        detail: `Không thể kết nối Supabase: ${error.message}`
      };
    }
    return {
      configured: true,
      status: 'CONNECTED',
      detail: `Đã kết nối Supabase Cloud Storage (Bucket: ${BUCKET_NAME})`
    };
  } catch (err) {
    return {
      configured: true,
      status: 'ERROR',
      detail: err.message
    };
  }
}

module.exports = {
  isCloudConfigured: Boolean(supabase),
  pullFromCloud,
  pushToCloud,
  scheduleCloudSync,
  checkCloudStatus
};

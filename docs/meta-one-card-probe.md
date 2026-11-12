# ทดลอง One Card ผ่าน Meta Marketing API

รหัสใน `server/one-card-creative.cjs` เตรียมคำขอสามขั้น: อัปโหลดภาพในบัญชีโฆษณา (`/adimages`), สร้าง Ad Creative ที่มีภาพ ลิงก์ และปุ่ม `LEARN_MORE` (`/adcreatives`), แล้วอ่าน `effective_object_story_id` กลับมา ผลลัพธ์คือ **unpublished Page post**; การสร้าง creative ไม่ได้เผยแพร่หน้าเพจหรือเริ่มใช้เงินโฆษณา

รัน `node --test tests/one-card-creative.test.js` เพื่อตรวจ payload และลำดับคำขอด้วย Meta จำลอง ไม่มีการใช้ token จริงหรือส่งโพสต์จริง

## ขั้นที่ต้องพิสูจน์กับ Meta จริงก่อนเปิดใช้ใน AFF

1. ตั้ง Meta App ของ AFF และสิทธิ์ `pages_show_list`, `pages_manage_posts`, `ads_management` สำหรับผู้ทดสอบที่จัดการทั้งเพจและบัญชีโฆษณา
2. ให้ผู้ใช้อนุญาตผ่าน Facebook Login; ตรวจเพจ บัญชีโฆษณา และสิทธิ์ของผู้ใช้จาก Meta อย่าให้ผู้ใช้กรอก token หรือส่งคุกกี้ Facebook ให้เว็บ
3. อัปโหลดภาพทดสอบและสร้าง unpublished creative ในบัญชีโฆษณาที่ผู้ใช้เลือก ตรวจ `effective_object_story_id` และตัวอย่างภาพ/ลิงก์จาก Meta
4. ทดสอบแยกว่ารูปแบบนี้เผยแพร่บนหน้าเพจโดยไม่ซื้อโฆษณาได้หรือไม่ และกดภาพบน Facebook จริง หากไม่ได้ ให้ใช้โพสต์ลิงก์แบบ Pages API หรือโฆษณาตามรูปแบบที่ Meta รองรับ ไม่ถือว่า creative คือโพสต์สำเร็จ

ณ วันที่ 25 ต.ค. 2026 ระบบ AFF ยังไม่ได้ตั้ง Meta App หรือเชื่อมเพจ บัญชีโฆษณา จึงยังทดสอบกับ Meta จริงไม่ได้ บททดลองนี้ไม่ถูกเรียกจากหน้าเว็บหรือคิวโพสต์จริง

อ้างอิง: https://developers.facebook.com/docs/marketing-api/reference/ad-creative-object-story-spec/ และ https://developers.facebook.com/docs/marketing-api/reference/ad-creative-link-data/

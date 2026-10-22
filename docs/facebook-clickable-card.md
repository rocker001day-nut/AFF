# โพสต์ภาพที่กดแล้วเปิดลิงก์ · AFF

## สิ่งที่ตรวจจาก Metus

หน้าเครื่องมือ Metus ที่เปิดเผยได้มีสองแบบที่เกี่ยวข้อง:

- โพสต์ภาพปกติ: เลือกบัญชี/เพจ อัปภาพ และตั้งเวลา
- การ์ดลิงก์: เลือกบัญชี/เพจ/บัญชี Ads กำหนด URL ปลายทางและ URL แสดงผล เลือกรูปแบบภาพ/อัลบั้ม แล้วโพสต์หรือตั้งเวลา

หน้า https://metus.vn/post-a-card ไม่เปิดเผยขั้นตอน API ภายใน จึงยังยืนยันไม่ได้ว่าเขาใช้คำขอ API ลำดับใด อย่าคัดลอกคุกกี้หรือเรียก private endpoints ของเว็บนั้น

## ทางเลือก Meta ที่ต้องพิสูจน์กับบัญชีจริง

1. Organic Page link post: POST /{page-id}/feed พร้อม link และ message ให้ภาพและข้อความของการ์ดมาจาก Open Graph ของ URL ที่แชร์ วิธีนี้คลิกภาพออก URL ได้ แต่การบังคับภาพที่อัปโหลดแยกจาก URL และปุ่ม Learn More แบบตัวอย่างยังยืนยันไม่ได้
2. Marketing API creative: object_story_spec.link_data รองรับลิงก์ ภาพ และ call_to_action ร่วมกับ Page และบัญชีโฆษณา การสร้าง creative ทำให้เกิด unpublished Page post; **ไม่ถือว่าโพสต์เผยแพร่บนหน้าเพจแล้ว** ต้องทดสอบขั้นเผยแพร่จริงและตรวจ post ID
3. โพสต์ภาพผ่าน /{page-id}/photos สร้างภาพบนเพจ แต่คลิกภาพโดยปกติเปิดหน้าภาพบน Facebook ไม่ตอบโจทย์ URL ปลายทาง

ห้ามแสดงปุ่มโพสต์จริงว่าใช้งานได้จนกว่าจะได้ Page access token, สิทธิ์ pages_manage_posts/pages_show_list/pages_read_engagement, สิทธิ์บัญชี Ads เมื่อใช้ creative, และทดสอบกับเพจจริงที่ผู้ใช้มีสิทธิ์โดยยืนยันว่ากดภาพไปปลายทางได้ การแสดง FACEBOOK.COM เป็น URL แสดงผลทั้งที่ปลายทางอื่นไม่ใช่เงื่อนไขที่เราจะจำลอง

## ดีเลย์ระดับวินาที

เก็บ batch และ job หนึ่งแถวต่อหนึ่ง Page โดยบันทึกเนื้อหา/ภาพ/URL เป็น snapshot เดียวกัน กำหนด scheduled_at = start + index × delay_seconds มี unique(batch_id,page_id) ป้องกันทำซ้ำ มีสถานะ draft, queued, processing, posted, failed, uncertain พร้อม post_id, permalink, error และเวลาที่ตรวจผลจริง

หลังอนุมัติ batch ให้ background worker ทำงานตาม due time ขณะปิดเบราว์เซอร์ได้ Supabase pg_cron รองรับช่วงวินาทีใน Postgres รุ่นที่โปรเจกต์ใช้อยู่ แต่ต้องกำหนดความถี่ที่เหมาะสม ไม่ใช้ setTimeout ในแท็บเว็บ เมื่อตอบกลับคลุมเครือ ให้สถานะ uncertain และตรวจ Facebook ก่อน retry เพื่อไม่ให้เกิดโพสต์ซ้ำ

## สถานะของ branch นี้

หน้าสร้างโพสต์มีตัวอย่างภาพที่กด URL ได้, โหลดเพจจาก /api/facebook หากมี, แสดงเวลาคิวต่อเพจ, ตรวจ URL HTTPS และบันทึกร่างในเครื่อง ปุ่มส่งจริงปิดไว้ตามสถานะเชื่อมต่อปัจจุบัน ภาพร่างอยู่เฉพาะในเบราว์เซอร์และต้องเลือกใหม่เมื่อกลับมา ยังไม่มีการเขียนข้อมูลเข้าฐานข้อมูลหรือ Facebook

AFF repo ปัจจุบันมี UI ที่เรียก /api/facebook แต่ไม่มี route นี้ใน source ที่อ่านได้; Supabase project มี platform_credentials 0 แถว และยังไม่มี Edge Function หรือ pg_cron worker จึงยังไม่สามารถอ้างว่าส่งโพสต์อัตโนมัติได้

## เอกสารอ้างอิง

- Metus tools: https://app.metus.vn/tools
- Metus image posts: https://app.metus.vn/tools/posts-photos
- Metus card/album: https://app.metus.vn/tools/posts-albums-fake
- Meta Pages posts: https://developers.facebook.com/documentation/pages-api/posts
- Meta Page feed: https://developers.facebook.com/docs/graph-api/reference/page/feed/
- Meta Ad Creative Object Story Spec: https://developers.facebook.com/docs/marketing-api/reference/ad-creative-object-story-spec/
- Meta Open Graph sharing: https://developers.facebook.com/documentation/sharing/webmasters/images
- Supabase Cron: https://supabase.com/docs/guides/cron/quickstart

# AFF · โพสต์การ์ดภาพที่กดไปลิงก์บน Facebook

## การใช้งาน

1. เปิดหน้า “โพสต์ภาพ + ลิงก์” และกด **เชื่อม Facebook และดึงเพจ** ระบบใช้ Facebook Login ของ Meta; หากเบราว์เซอร์ล็อกอิน Facebook อยู่แล้ว มักเหลือเพียงหน้ากดยืนยันสิทธิ์ครั้งแรก ไม่มีช่องกรอก Page token
2. เลือกเพจที่ Facebook คืนมา ใส่ภาพ JPG/PNG/WebP ไม่เกิน 8 MB, ข้อความ และลิงก์ HTTPS
3. ตั้งระยะห่าง 5–3,600 วินาทีระหว่างเพจ แล้วกด **โพสต์ตอนนี้** (เริ่มประมาณ 20 วินาทีหลังสั่ง) หรือ **ตั้งคิวตามเวลา** ระบบส่งทีละรายการขณะปิดหน้าเว็บได้
4. ดูสถานะของแต่ละเพจ: รอส่ง, กำลังส่ง, โพสต์สำเร็จพร้อม post ID, ไม่สำเร็จ, หรือรอตรวจผลกรณี Facebook ตอบคลุมเครือ ไม่มีการ retry อัตโนมัติเมื่อผลคลุมเครือ

## กลไก

- Supabase Edge Function `facebook-publisher` รองรับ Facebook OAuth login/callback, ดึงเพจผ่าน `/me/accounts`, เก็บ Page access token แบบเข้ารหัสฝั่งเซิร์ฟเวอร์, อัปโหลดภาพ, สร้างคิว, ตอบ Open Graph HTML และเรียก Graph API `POST /{page-id}/feed` โดยใส่ `link` เป็น URL การ์ดของ AFF
- การ์ดมี `og:image` จากภาพที่อัปโหลดและแสดงโดเมนปลายทางชัดเจน เมื่อมนุษย์เปิดการ์ดในเบราว์เซอร์ โค้ดหน้าเว็บจะเปลี่ยนไป URL ปลายทางทันที มีลิงก์สำรองให้กด
- ฐานข้อมูลใช้ RLS และปิดการเข้าถึงตารางจาก `anon` / `authenticated`; worker มี secret ของตัวเองและ claim งานแบบ atomic. Cron ตรวจทุก 5 วินาที และเรียก Edge Function เฉพาะเมื่อมีรายการถึงเวลา
- Facebook ควบคุมหน้าตาการ์ด ภาพครอป ข้อความปุ่ม และการเปิดลิงก์ในแอปเอง **ยังรับประกันรูปแบบเหมือนภาพตัวอย่างหรือปุ่ม “เรียนรู้เพิ่มเติม” ไม่ได้** ต้องโพสต์ทดสอบจริงและกดภาพบน Facebook เพื่อยืนยัน
- ช่องว่างระหว่างเวลาในคิวตั้งได้เป็นวินาที การส่งจริงมีความคลาดเคลื่อนตามเวลาเรียก worker และเวลา Facebook ตอบ

## ตั้งค่าที่จำเป็นก่อนเชื่อมบัญชี

ผู้ดูแล Meta App ต้องกำหนด Facebook Login redirect URI เป็น:

`https://txbsrtunejnqaheuohck.supabase.co/functions/v1/facebook-publisher?action=callback`

ตั้งค่า Supabase Edge Function secrets `META_APP_ID` และ `META_APP_SECRET` ของแอป Meta ที่มีสิทธิ์ `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` และเพิ่มโดเมน AFF ใน Meta App Dashboard. **ห้ามส่ง App Secret หรือ Page token ในแชตหรือ commit ลง Git.** ผู้ที่ใช้แอปนอกบทบาท developer/tester อาจต้องขอ Advanced Access/App Review ตามการตั้งค่าของแอป.

ตอนนี้ยังไม่มี Meta App secrets ของ AFF ใน Supabase และยังไม่มี Facebook Page ที่เชื่อมในระบบ: worker และฐานข้อมูลทำงานแล้ว แต่ยังไม่เคยได้ post ID จาก Facebook และยังไม่ได้กดภาพจากโพสต์จริงเพื่อยืนยันปลายทาง

## ข้อจำกัดการทดสอบและความเสี่ยง

- Facebook อาจไม่สร้างการ์ดจาก HTML/OG ตามที่คาด หรือใช้ preview cache; ต้องใช้ Facebook Sharing Debugger ตรวจภาพและกดโพสต์จริงหนึ่งเพจ
- Direct redirect ด้วย JavaScript อาจถูก Facebook บังคับหน้าเตือนลิงก์ หรือเปลี่ยนพฤติกรรมในแอป; เว็บจะบอกปลายทางตรงๆ และไม่ซ่อนโดเมนจริง
- OAuth callback เก็บ state ใช้ครั้งเดียว 10 นาที การหมุน service role key จะทำให้ถอดรหัส Page token เดิมไม่ได้; ต้องเชื่อมบัญชีใหม่
- โปรเจกต์นี้ยังไม่ได้เปิดปุ่มยืนยันรูปแบบโฆษณาแบบ unpublished creative; Marketing API ที่สร้าง creative ยังไม่ถือว่าเป็นโพสต์เพจที่เผยแพร่

## เอกสาร

- https://developers.facebook.com/documentation/pages-api
- https://developers.facebook.com/documentation/pages-api/manage-pages
- https://developers.facebook.com/docs/graph-api/reference/page/feed/
- https://supabase.com/docs/guides/cron/quickstart
- https://supabase.com/docs/guides/functions/auth

"""生成 dsh-websift 的插件图标（256×256 PNG）。"""
from PIL import Image, ImageDraw

S = 256
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# 渐变底：左上亮蓝 → 右下深蓝
grad = Image.new("RGB", (S, S), (59, 130, 246))
d = ImageDraw.Draw(grad)
for i in range(S * 2):
    t = i / (S * 2 - 1)
    r = int(59 + (29 - 59) * t)
    g = int(130 + (78 - 130) * t)
    b = int(246 + (216 - 246) * t)
    d.line([(0, i), (i, 0)], fill=(r, g, b), width=1)

# 圆角遮罩
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=56, fill=255)
img.paste(grad, (0, 0), mask)

d = ImageDraw.Draw(img)
# 浏览器窗口
d.rounded_rectangle([52, 66, 204, 196], radius=16, fill=(255, 255, 255))
# 标题栏
d.rounded_rectangle([52, 66, 204, 96], radius=16, fill=(230, 238, 252))
d.rectangle([52, 82, 204, 96], fill=(230, 238, 252))
# 三个圆点
for i, color in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
    cx = 70 + i * 17
    d.ellipse([cx - 5, 76, cx + 5, 86], fill=color)

# 地球（浏览器内容）
blue = (37, 99, 235)
cx, cy, r = 128, 150, 27
d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=blue, width=6)
d.line([cx - r + 4, cy, cx + r - 4, cy], fill=blue, width=5)
d.ellipse([cx - 11, cy - r, cx + 11, cy + r], outline=blue, width=4)

img.save(r"C:\Users\Administrator\Documents\deepseek-harness\default-workspace\plugins\dsh-websift\docs\icon.png", "PNG")
print("ok", img.size)

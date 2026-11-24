"""Render promotional bitmap assets from verified, current Nowly captures."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "video-source" / "assets"
SCREENS = ASSETS / "screens"
OUT = ROOT / "xiaohongshu"
OUT.mkdir(exist_ok=True)
INK, MUTED, ACCENT, GROUND = "#211F1C", "#716D66", "#4FC9DA", "#F8F6F2"
FONT = Path("C:/Windows/Fonts/msyh.ttc")
BOLD = Path("C:/Windows/Fonts/msyhbd.ttc")
logo = Image.open(ROOT.parents[2] / "public" / "logo.png").convert("RGBA")

def text(draw, xy, value, size, bold=False, fill=INK):
    font = ImageFont.truetype(str(BOLD if bold else FONT), size)
    draw.text(xy, value, font=font, fill=fill, spacing=int(size * .3))

def screen(name, crop=None):
    im = Image.open(SCREENS / f"{name}.jpg").convert("RGB")
    return im.crop(crop) if crop else im

def fit_on(canvas, im, box):
    x, y, w, h = box
    scaled = ImageOps.contain(im, (w, h), Image.Resampling.LANCZOS)
    canvas.paste(scaled, (x + (w-scaled.width)//2, y + (h-scaled.height)//2))

def frame(im, size, box, name):
    canvas = Image.new("RGB", size, GROUND)
    if im:
        fit_on(canvas, im, box)
    canvas.save(ASSETS / f"{name}.png")

items = [
    ("把今天，\n放在眼前", "Nowly · Windows 个人工作桌面", screen("workspace"),
     "日程、任务、便签\n放进同一个工作区", "workspace"),
    ("先看清\n下一件事", "四象限 · 区分重要与紧急", screen("workspace", (1290, 165, 2160, 655)),
     "把优先级摆出来\n先做重要的事", "matrix"),
    ("让进度\n有迹可循", "看板 · 从待处理到待验收", screen("project", (930, 165, 2160, 655)),
     "用泳道整理流程\n任务放在眼前", "kanban"),
    ("留一点时间\n给专注", "时间 · 专注时段与世界时钟", screen("focus", (490, 350, 990, 850)),
     "从一段专注开始\n一步一步完成今天", "focus"),
    ("想法来了\n先记下来", "便签 · 留住下一次需要的信息", screen("notes", (60, 180, 700, 415)),
     "灵感、备忘、阅读摘记\n不必都变成任务", "notes"),
    ("你的桌面\n你来组织", "Nowly · 从一个模块开始", screen("study"),
     "按自己的习惯搭配模块\n工作、学习，都有自己的摆法", "study"),
]
for i, (headline, sub, im, takeaway, name) in enumerate(items, 1):
    canvas = Image.new("RGB", (1080, 1440), GROUND)
    d = ImageDraw.Draw(canvas)
    text(d, (72, 70), sub, 28, fill=MUTED)
    text(d, (68, 132), headline, 78, bold=True)
    d.rectangle((72, 365, 200, 373), fill=ACCENT)
    fit_on(canvas, im, (56, 420, 968, 650))
    text(d, (72, 1130), takeaway, 40, bold=True)
    text(d, (72, 1320), f"Nowly  ·  演示界面 / 演示数据    {i}/6", 24, fill=MUTED)
    canvas.save(OUT / f"{i:02d}-{name}.png")

# Film images contain authentic UI only; explanatory titles remain editable HTML.
for mode, size, box in [
    ("landscape", (1920,1080), (112,264,1696,720)),
    ("portrait", (1080,1920), (76,550,856,640)),
]:
    frame(screen("workspace"), size, box, f"{mode}-intro")
    frame(screen("project", (930,165,2160,655)), size, box, f"{mode}-tasks")
    frame(screen("focus", (490,350,990,850)), size, box, f"{mode}-focus")
    frame(None, size, box, f"{mode}-video")
    end = Image.new("RGB", size, GROUND)
    mark = ImageOps.contain(logo, (220,220) if mode == "landscape" else (180,180))
    end.paste(mark, (850,340) if mode == "landscape" else (430,620), mark)
    end.save(ASSETS / f"{mode}-end.png")

cover = Image.open(ASSETS / "landscape-intro.png")
d = ImageDraw.Draw(cover)
text(d, (112,64), "把 Windows 桌面，变成工作台", 70, bold=True)
text(d, (116,168), "Nowly  ·  日程 / 任务 / 便签 / 时间", 36, fill=MUTED)
cover.save(ROOT / "bilibili-cover.png")
Image.open(OUT / "01-workspace.png").save(ROOT / "douyin-cover.png")
print("Rendered 6 social images, 10 film backgrounds and 2 covers.")

import sys
from lib import render_page

def main():
    if len(sys.argv) < 4:
        print("Usage: python render_pages.py <pdf_path> <page_index_0based> <out_png> [dpi]")
        raise SystemExit(1)
    pdf_path, page_index, out_png = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    dpi = int(sys.argv[4]) if len(sys.argv) > 4 else 300
    img = render_page(pdf_path, page_index, dpi=dpi)
    img.save(out_png)
    print(f"Saved {out_png} ({img.size[0]}x{img.size[1]}px, {dpi}dpi)")

if __name__ == "__main__":
    main()

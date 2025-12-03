import sys, json, zlib, struct
from pathlib import Path

def read_chunk(f):
    data = f.read(8)
    if len(data) < 8:
        return None, None, None
    length, = struct.unpack('>I', data[:4])
    ctype = data[4:8]
    chunk_data = f.read(length)
    crc = f.read(4)
    return ctype, chunk_data, length

# PNG unfilter helpers
def paeth_predict(a, b, c):
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    elif pb <= pc:
        return b
    else:
        return c

def unfilter_row(filter_type, row, prev_row, bpp):
    if filter_type == 0:
        return row
    out = bytearray(len(row))
    if filter_type == 1:  # Sub
        for i in range(len(row)):
            left = out[i - bpp] if i >= bpp else 0
            out[i] = (row[i] + left) & 0xFF
    elif filter_type == 2:  # Up
        for i in range(len(row)):
            up = prev_row[i] if prev_row is not None else 0
            out[i] = (row[i] + up) & 0xFF
    elif filter_type == 3:  # Average
        for i in range(len(row)):
            left = out[i - bpp] if i >= bpp else 0
            up = prev_row[i] if prev_row is not None else 0
            out[i] = (row[i] + ((left + up) >> 1)) & 0xFF
    elif filter_type == 4:  # Paeth
        for i in range(len(row)):
            left = out[i - bpp] if i >= bpp else 0
            up = prev_row[i] if prev_row is not None else 0
            up_left = prev_row[i - bpp] if (prev_row is not None and i >= bpp) else 0
            out[i] = (row[i] + paeth_predict(left, up, up_left)) & 0xFF
    else:
        raise Exception('Unknown filter')
    return bytes(out)


def inspect_png(path):
    p = Path(path)
    if not p.exists():
        return {"error": "file_not_found", "path": str(p)}
    with open(p, 'rb') as f:
        sig = f.read(8)
        if sig != b'\x89PNG\r\n\x1a\n':
            return {"error": "not_png", "path": str(p)}
        ihdr = None
        idat_chunks = []
        while True:
            header = f.read(8)
            if not header or len(header) < 8:
                break
            length, ctype = struct.unpack('>I4s', header)
            ctype = ctype
            data = f.read(length)
            crc = f.read(4)
            if ctype == b'IHDR':
                ihdr = struct.unpack('>IIBBBBB', data)
                width, height, bit_depth, color_type, comp, filter_method, interlace = ihdr
            elif ctype == b'IDAT':
                idat_chunks.append(data)
            elif ctype == b'IEND':
                break
            # else skip
        if ihdr is None:
            return {"error": "no_ihdr"}
        width, height, bit_depth, color_type, comp, filter_method, interlace = ihdr
        try:
            raw = zlib.decompress(b''.join(idat_chunks))
        except Exception as e:
            return {"error": "zlib_decompress_failed", "details": str(e)}
        # determine bytes per pixel
        if bit_depth != 8:
            return {"error": "unsupported_bit_depth", "bit_depth": bit_depth}
        if color_type == 6:  # RGBA
            bpp = 4
        elif color_type == 2:  # RGB
            bpp = 3
        elif color_type == 3:  # indexed
            return {"error": "indexed_palette_not_supported"}
        elif color_type == 0:  # grayscale
            bpp = 1
        elif color_type == 4:  # gray+alpha
            bpp = 2
        else:
            return {"error": "unsupported_color_type", "color_type": color_type}
        stride = width * bpp
        offset = 0
        prev_row = None
        non_transparent = 0
        total = width * height
        first_color = None
        uniform = True
        for row in range(height):
            if offset >= len(raw):
                break
            filter_type = raw[offset]
            offset += 1
            rowdata = raw[offset:offset+stride]
            offset += stride
            try:
                un = unfilter_row(filter_type, rowdata, prev_row, bpp)
            except Exception:
                un = rowdata
            prev_row = un
            if color_type == 6:
                for i in range(0, len(un), 4):
                    r = un[i]; g = un[i+1]; b = un[i+2]; a = un[i+3]
                    if first_color is None:
                        first_color = (r, g, b, a)
                    else:
                        if first_color != (r, g, b, a):
                            uniform = False
                    if a > 0 and (r != 0 or g != 0 or b != 0):
                        non_transparent += 1
        return {"path": str(p), "width": width, "height": height, "total_pixels": total, "non_transparent": non_transparent, "first_color": first_color, "uniform_color": uniform}

if __name__ == '__main__':
    path = r'C:\Qtiler\cache\nogo\NoGO_vind_under_65ms\5\0\0.png'
    if len(sys.argv) > 1:
        path = sys.argv[1]
    result = inspect_png(path)
    print(json.dumps(result))
    sys.exit(0)

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function write16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function write32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

/** Creates a standards-compliant, uncompressed ZIP containing one UTF-8 text file. */
export function singleFileZip(filename: string, content: string): Uint8Array {
  const name = encoder.encode(filename);
  const data = encoder.encode(content);
  const localLength = 30 + name.length + data.length;
  const centralLength = 46 + name.length;
  const output = new Uint8Array(localLength + centralLength + 22);
  const view = new DataView(output.buffer);
  const checksum = crc32(data);

  write32(view, 0, 0x04034b50);
  write16(view, 4, 20);
  write16(view, 6, 0x0800);
  write16(view, 8, 0);
  write16(view, 10, 0);
  write16(view, 12, 0);
  write32(view, 14, checksum);
  write32(view, 18, data.length);
  write32(view, 22, data.length);
  write16(view, 26, name.length);
  write16(view, 28, 0);
  output.set(name, 30);
  output.set(data, 30 + name.length);

  const central = localLength;
  write32(view, central, 0x02014b50);
  write16(view, central + 4, 20);
  write16(view, central + 6, 20);
  write16(view, central + 8, 0x0800);
  write16(view, central + 10, 0);
  write16(view, central + 12, 0);
  write16(view, central + 14, 0);
  write32(view, central + 16, checksum);
  write32(view, central + 20, data.length);
  write32(view, central + 24, data.length);
  write16(view, central + 28, name.length);
  write16(view, central + 30, 0);
  write16(view, central + 32, 0);
  write16(view, central + 34, 0);
  write16(view, central + 36, 0);
  write32(view, central + 38, 0);
  write32(view, central + 42, 0);
  output.set(name, central + 46);

  const end = central + centralLength;
  write32(view, end, 0x06054b50);
  write16(view, end + 4, 0);
  write16(view, end + 6, 0);
  write16(view, end + 8, 1);
  write16(view, end + 10, 1);
  write32(view, end + 12, centralLength);
  write32(view, end + 16, localLength);
  write16(view, end + 20, 0);
  return output;
}

import AppKit

// The icon arrived as a cream squircle painted on a BLACK square, with an alpha channel.
// Two defects in one file: Apple rejects alpha outright, and iOS applies its OWN squircle
// mask — so a pre-rounded icon on black shows black wedges around the artwork.
//
// FLOOD FILL FROM THE BORDER, not a colour replace. The artwork contains dark navy
// (#2B3A44-ish) inside it, and a global "replace dark with cream" would eat the document
// outline and the speech bubble. Only the contiguous black region TOUCHING THE EDGE is
// background, and a flood fill is the one operation that says exactly that.
let inPath = CommandLine.arguments[1], outPath = CommandLine.arguments[2]
guard let img = NSImage(contentsOfFile: inPath), let tiff = img.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff) else { exit(2) }
let w = rep.pixelsWide, h = rep.pixelsHigh

guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8,
                          bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
      let cg = rep.cgImage else { exit(3) }
ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
guard let buf = ctx.data else { exit(4) }
let px = buf.bindMemory(to: UInt8.self, capacity: w * h * 4)

// The background the corners become: sampled from the flat cream field at top-centre.
let bgI = (60 * w + w/2) * 4
let (br, bg_, bb) = (px[bgI], px[bgI+1], px[bgI+2])

@inline(__always) func isBackgroundBlack(_ i: Int) -> Bool {
  // Generous on darkness, strict on neutrality: the navy in the artwork has a clear blue
  // bias, the background does not. Also treats transparent pixels as background.
  let r = Int(px[i]), g = Int(px[i+1]), b = Int(px[i+2]), a = Int(px[i+3])
  if a < 24 { return true }
  let maxc = max(r, max(g, b))
  return maxc < 46 && (maxc - min(r, min(g, b))) < 18
}

var stack = [Int]()
for x in 0..<w { stack.append(x); stack.append((h-1) * w + x) }
for y in 0..<h { stack.append(y * w); stack.append(y * w + (w-1)) }
var seen = [Bool](repeating: false, count: w * h)
var filled = 0
while let p = stack.popLast() {
  if p < 0 || p >= w * h || seen[p] { continue }
  let i = p * 4
  if !isBackgroundBlack(i) { continue }
  seen[p] = true
  px[i] = br; px[i+1] = bg_; px[i+2] = bb; px[i+3] = 255
  filled += 1
  let x = p % w, y = p / w
  if x > 0 { stack.append(p - 1) }
  if x < w-1 { stack.append(p + 1) }
  if y > 0 { stack.append(p - w) }
  if y < h-1 { stack.append(p + w) }
}
print("filled \(filled) background pixels (\(filled * 100 / (w*h))% of the canvas)")

// Re-render OPAQUE: alpha dropped, not merely set to 255.
guard let mid = ctx.makeImage(),
      let opaque = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8,
                             bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
                             bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { exit(5) }
opaque.setFillColor(CGColor(red: CGFloat(br)/255, green: CGFloat(bg_)/255, blue: CGFloat(bb)/255, alpha: 1))
opaque.fill(CGRect(x: 0, y: 0, width: w, height: h))
opaque.draw(mid, in: CGRect(x: 0, y: 0, width: w, height: h))
guard let out = opaque.makeImage(),
      let png = NSBitmapImageRep(cgImage: out).representation(using: .png, properties: [:]) else { exit(6) }
try png.write(to: URL(fileURLWithPath: outPath))
print("wrote \(outPath)")

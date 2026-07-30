#!/usr/bin/env swift
import AppKit
import CoreGraphics
import Foundation

// Рисует фон окна установки для LocalBoard.dmg.
//
// Намеренно тихий: содержимое окна — две иконки, которые Finder кладёт сверху,
// поэтому фону достаточно дать им поверхность и показать направление. Всё, что
// громче, конкурирует с тем единственным действием, которое от человека нужно.
//
// Отдаёт многослойный TIFF (1x + 2x), чтобы панель оставалась чёткой на Retina:
// обычный PNG в логическом размере там заметно мылит.

let size = CGSize(width: 640, height: 420)

/// Центры иконок в координатах Finder (начало — верхний левый угол).
/// Раскладка в `build-release.sh` обязана использовать ровно эти значения.
let appIconCentre = CGPoint(x: 160, y: 210)
let applicationsIconCentre = CGPoint(x: 480, y: 210)

/// Акцент бренда — фиолетовый из иконки приложения, приглушённый до уровня фона.
let accent = CGColor(srgbRed: 0.435, green: 0.373, blue: 0.867, alpha: 1)

func render(scale: CGFloat) -> NSBitmapImageRep {
    let pixelWidth = Int(size.width * scale)
    let pixelHeight = Int(size.height * scale)
    guard let context = CGContext(
        data: nil,
        width: pixelWidth,
        height: pixelHeight,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { fatalError("cannot create bitmap context") }

    context.scaleBy(x: scale, y: scale)

    // Вертикальный градиент, очень пологий, с холодным фиолетовым подтоном.
    // Плоская заливка читается как «недоделанное окно», сильная — спорит с иконками.
    let gradient = CGGradient(
        colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
        colors: [
            CGColor(srgbRed: 0.984, green: 0.980, blue: 0.996, alpha: 1),
            CGColor(srgbRed: 0.925, green: 0.918, blue: 0.965, alpha: 1),
        ] as CFArray,
        locations: [0, 1]
    )!
    context.drawLinearGradient(
        gradient,
        start: CGPoint(x: 0, y: size.height),
        end: CGPoint(x: 0, y: 0),
        options: []
    )

    // Перевод из системы Finder (origin сверху) в систему Core Graphics (origin снизу).
    func flipped(_ point: CGPoint) -> CGPoint {
        CGPoint(x: point.x, y: size.height - point.y)
    }

    let from = flipped(appIconCentre)
    let to = flipped(applicationsIconCentre)
    let midpoint = CGPoint(x: (from.x + to.x) / 2, y: from.y)

    // Одна шевронная стрелка между иконками: минимальный знак, который говорит
    // «тащи туда» без строки инструкции, которую всё равно никто не читает.
    let armLength: CGFloat = 17
    let arrow = CGMutablePath()
    arrow.move(to: CGPoint(x: midpoint.x - armLength * 0.62, y: midpoint.y + armLength))
    arrow.addLine(to: CGPoint(x: midpoint.x + armLength * 0.62, y: midpoint.y))
    arrow.addLine(to: CGPoint(x: midpoint.x - armLength * 0.62, y: midpoint.y - armLength))

    context.setStrokeColor(accent.copy(alpha: 0.45)!)
    context.setLineWidth(7)
    context.setLineCap(.round)
    context.setLineJoin(.round)
    context.addPath(arrow)
    context.strokePath()

    // Название продукта над иконками — окно установки открывается из Finder без
    // всякой рамки контекста, и это единственное место, где можно назвать вещь.
    let title = "LocalBoard"
    let attributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: 21, weight: .semibold),
        .foregroundColor: NSColor(cgColor: accent.copy(alpha: 0.75)!)!,
        .kern: 0.4,
    ]
    let line = NSAttributedString(string: title, attributes: attributes)
    let lineSize = line.size()

    let graphicsContext = NSGraphicsContext(cgContext: context, flipped: false)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphicsContext
    line.draw(at: CGPoint(
        x: (size.width - lineSize.width) / 2,
        y: flipped(CGPoint(x: 0, y: 78)).y
    ))
    NSGraphicsContext.restoreGraphicsState()

    guard let image = context.makeImage() else { fatalError("cannot render image") }
    let representation = NSBitmapImageRep(cgImage: image)
    representation.size = size // логические точки, чтобы 2x-слой пометился как HiDPI
    return representation
}

let outputPath = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : "background.tiff"

// LZW держит оба слоя в пределах сотни килобайт вместо пяти мегабайт — на
// небольшом установщике несжатая версия заняла бы больше, чем само приложение.
let data = NSBitmapImageRep.representationOfImageReps(
    in: [render(scale: 1), render(scale: 2)],
    using: .tiff,
    properties: [.compressionMethod: NSBitmapImageRep.TIFFCompression.lzw.rawValue]
)

guard let data else { fatalError("cannot encode TIFF") }
try data.write(to: URL(fileURLWithPath: outputPath))
print(outputPath)

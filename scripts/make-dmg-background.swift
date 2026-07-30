#!/usr/bin/env swift
import AppKit
import CoreGraphics
import Foundation

// Рисует фон окна установки для LocalBoard.dmg.
//
//   swift make-dmg-background.swift <путь.tiff> [версия]
//
// Окно установщика — единственный экран, который человек видит до первого
// запуска, и открывается он без всякой рамки контекста: ни названия продукта,
// ни объяснения, почему macOS сейчас будет ругаться на неизвестного
// разработчика. Поэтому фон здесь не декорация, а сам экран: холст в точечную
// сетку (тот же, что внутри приложения), две карточки под иконки, рисованная
// от руки стрелка между ними и строка про первый запуск внизу.
//
// Полотно намеренно выше содержимого окна: заголовок съедает ~28 pt сверху, а
// включённая строка пути Finder — ещё столько же снизу, и без запаса нижние
// строки обрезаются у тех, у кого она включена.
//
// Отдаёт многослойный TIFF (1x + 2x): обычный PNG в логическом размере на
// Retina заметно мылит.

let size = CGSize(width: 700, height: 520)

/// Центры иконок в координатах Finder (начало — верхний левый угол).
/// Раскладка в `build-release.sh` обязана использовать ровно эти значения.
let appIconCentre = CGPoint(x: 175, y: 240)
let applicationsIconCentre = CGPoint(x: 525, y: 240)

/// Палитра — из иконки приложения: фиолетовые чернила по холодной бумаге.
let accent = CGColor(srgbRed: 0.435, green: 0.373, blue: 0.867, alpha: 1)
let ink = CGColor(srgbRed: 0.208, green: 0.184, blue: 0.361, alpha: 1)

let version = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : ""

func render(scale: CGFloat) -> NSBitmapImageRep {
    guard let context = CGContext(
        data: nil,
        width: Int(size.width * scale),
        height: Int(size.height * scale),
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { fatalError("cannot create bitmap context") }

    context.scaleBy(x: scale, y: scale)

    /// Перевод из системы Finder (origin сверху) в систему Core Graphics (снизу).
    func flipped(_ point: CGPoint) -> CGPoint {
        CGPoint(x: point.x, y: size.height - point.y)
    }

    // --- Бумага ------------------------------------------------------------
    // Пологий градиент с фиолетовым подтоном. Плоская заливка читается как
    // «недоделанное окно», сильная — спорит с иконками, которые Finder кладёт
    // сверху и которые здесь и есть содержание.
    let paper = CGGradient(
        colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
        colors: [
            CGColor(srgbRed: 0.992, green: 0.988, blue: 1.000, alpha: 1),
            CGColor(srgbRed: 0.914, green: 0.906, blue: 0.965, alpha: 1),
        ] as CFArray,
        locations: [0, 1]
    )!
    context.drawLinearGradient(
        paper,
        start: CGPoint(x: 0, y: size.height),
        end: CGPoint(x: 0, y: 0),
        options: []
    )

    // --- Точечная сетка ----------------------------------------------------
    // Тот же бесконечный холст, что человек увидит внутри приложения: окно
    // установки перестаёт быть безымянной коробкой и начинает выглядеть как
    // часть продукта. Держать её нужно на грани заметности — сетка работает
    // фоном, а не узором.
    context.setFillColor(accent.copy(alpha: 0.09)!)
    let step: CGFloat = 26
    var gridY = step
    while gridY < size.height {
        var gridX = step
        while gridX < size.width {
            context.fillEllipse(in: CGRect(x: gridX - 1.1, y: gridY - 1.1, width: 2.2, height: 2.2))
            gridX += step
        }
        gridY += step
    }

    // --- Карточки под иконки ----------------------------------------------
    // Иконку и подпись Finder рисует поверх фона без всякой подложки, и на
    // холсте в сетку они висят в воздухе. Карточка даёт им место и заодно
    // говорит, что перетаскивают именно предмет, а не картинку.
    func card(around centre: CGPoint) {
        let rect = CGRect(
            x: centre.x - 92,
            y: flipped(centre).y - 118,
            width: 184,
            height: 204
        )
        context.saveGState()
        context.setShadow(
            offset: CGSize(width: 0, height: -6),
            blur: 22,
            color: CGColor(srgbRed: 0.208, green: 0.184, blue: 0.361, alpha: 0.13)
        )
        context.setFillColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 0.92))
        context.addPath(CGPath(roundedRect: rect, cornerWidth: 24, cornerHeight: 24, transform: nil))
        context.fillPath()
        context.restoreGState()

        context.setStrokeColor(accent.copy(alpha: 0.16)!)
        context.setLineWidth(1)
        context.addPath(CGPath(
            roundedRect: rect.insetBy(dx: 0.5, dy: 0.5),
            cornerWidth: 24, cornerHeight: 24, transform: nil
        ))
        context.strokePath()
    }
    card(around: appIconCentre)
    card(around: applicationsIconCentre)

    // --- Стрелка от руки ---------------------------------------------------
    // Excalidraw рисует всё «от руки», и прямая векторная стрелка здесь звучала
    // бы чужим голосом. Линия ведётся двумя проходами с лёгким расхождением —
    // так же, как это делает сам редактор, — и потому выглядит нарисованной, а
    // не построенной. Смещения зафиксированы, чтобы сборка была воспроизводимой.
    let from = CGPoint(x: flipped(appIconCentre).x + 100, y: flipped(appIconCentre).y)
    let to = CGPoint(x: flipped(applicationsIconCentre).x - 100, y: flipped(applicationsIconCentre).y)

    context.setStrokeColor(accent.copy(alpha: 0.72)!)
    context.setLineCap(.round)
    context.setLineJoin(.round)

    let passes: [(start: CGPoint, control: CGPoint, end: CGPoint, width: CGFloat)] = [
        (CGPoint(x: from.x, y: from.y + 1.5),
         CGPoint(x: (from.x + to.x) / 2, y: from.y + 15),
         CGPoint(x: to.x - 1, y: to.y + 2),
         3.4),
        (CGPoint(x: from.x + 2, y: from.y - 2),
         CGPoint(x: (from.x + to.x) / 2 + 6, y: from.y + 10),
         CGPoint(x: to.x, y: to.y - 1),
         2.2),
    ]
    for pass in passes {
        let path = CGMutablePath()
        path.move(to: pass.start)
        path.addQuadCurve(to: pass.end, control: pass.control)
        context.setLineWidth(pass.width)
        context.addPath(path)
        context.strokePath()
    }

    // Наконечник — двумя штрихами, как дорисовывают карандашом.
    let head = CGMutablePath()
    head.move(to: CGPoint(x: to.x - 19, y: to.y + 12))
    head.addLine(to: CGPoint(x: to.x, y: to.y + 1))
    head.move(to: CGPoint(x: to.x - 17, y: to.y - 12))
    head.addLine(to: CGPoint(x: to.x + 1, y: to.y - 1))
    context.setLineWidth(3.2)
    context.addPath(head)
    context.strokePath()

    // --- Текст -------------------------------------------------------------
    let graphicsContext = NSGraphicsContext(cgContext: context, flipped: false)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphicsContext

    /// Рисует строку по центру окна на заданной высоте в координатах Finder.
    func centred(_ text: String, font: NSFont, color: CGColor, topY: CGFloat, kern: CGFloat = 0) {
        let line = NSAttributedString(string: text, attributes: [
            .font: font,
            .foregroundColor: NSColor(cgColor: color)!,
            .kern: kern,
        ])
        let lineSize = line.size()
        line.draw(at: CGPoint(
            x: (size.width - lineSize.width) / 2,
            y: flipped(CGPoint(x: 0, y: topY)).y - lineSize.height
        ))
    }

    centred(
        "LocalBoard",
        font: .systemFont(ofSize: 30, weight: .bold),
        color: ink,
        topY: 46,
        kern: -0.3
    )
    centred(
        "Перетащите приложение в «Программы»",
        font: .systemFont(ofSize: 14, weight: .medium),
        color: ink.copy(alpha: 0.58)!,
        topY: 84
    )

    // Строка про первый запуск. Ровно здесь она и нужна: предупреждение
    // «неизвестный разработчик» человек увидит через минуту после этого окна,
    // и без объяснения оно читается как «приложение сломано».
    centred(
        "При первом запуске: Системные настройки → Конфиденциальность и безопасность → «Всё равно открыть»",
        font: .systemFont(ofSize: 11.5, weight: .regular),
        color: ink.copy(alpha: 0.42)!,
        topY: 441
    )

    if !version.isEmpty {
        centred(
            "версия \(version)",
            font: .systemFont(ofSize: 11, weight: .medium),
            color: accent.copy(alpha: 0.55)!,
            topY: 466
        )
    }

    NSGraphicsContext.restoreGraphicsState()

    guard let image = context.makeImage() else { fatalError("cannot render image") }
    let representation = NSBitmapImageRep(cgImage: image)
    representation.size = size // логические точки, чтобы 2x-слой пометился как HiDPI
    return representation
}

let outputPath = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : "background.tiff"

// LZW держит оба слоя в пределах сотен килобайт вместо десятков мегабайт.
let data = NSBitmapImageRep.representationOfImageReps(
    in: [render(scale: 1), render(scale: 2)],
    using: .tiff,
    properties: [.compressionMethod: NSBitmapImageRep.TIFFCompression.lzw.rawValue]
)

guard let data else { fatalError("cannot encode TIFF") }
try data.write(to: URL(fileURLWithPath: outputPath))
print(outputPath)

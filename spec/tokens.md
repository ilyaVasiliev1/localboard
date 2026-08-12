# Токены

Оформление схем, которые приходят из ящика. Единственный источник значений;
в коде этих чисел и цветов «руками» нет.

Оформление самого редактора продукту не принадлежит: холст рисует Excalidraw
своими средствами, и токенов у него мы не заводим.

---

## TOK-scheme.stroke — Цвет линий схемы
- value: #1e1e1e
- nearest: TOK-scheme.arrow-color
- reason: цвет на доске означает смысл, и расставляет его хозяин доски; схема
  приходит нейтральной, чтобы не занимать этот канал первой

## TOK-scheme.fill — Заливка блоков
- value: transparent
- nearest: TOK-scheme.stroke
- reason: белая заливка перекрыла бы сетку холста и всё, что нарисовано под
  схемой

## TOK-scheme.stroke-width — Толщина обводки
- value: 2
- nearest: TOK-scheme.arrow-width
- reason: средняя толщина читается и на общем плане доски, и вблизи, где тонкая
  линия выглядит недорисованной

## TOK-scheme.roughness — Небрежность линии
- value: 1
- nearest: TOK-scheme.stroke-width
- reason: рисованный вид редактора сохраняется, схема не выглядит вставкой из
  чужого инструмента

## TOK-scheme.roundness — Скругление блоков
- value: round
- nearest: TOK-scheme.roughness
- reason: мягкие углы отличают блок схемы от прямоугольника, нарисованного рукой

## TOK-scheme.arrow-color — Цвет связей
- value: #1e1e1e
- nearest: TOK-scheme.stroke
- reason: связь и блок принадлежат одной схеме и различаются формой, а не цветом

## TOK-scheme.arrow-width — Толщина связей
- value: 2
- nearest: TOK-scheme.stroke-width
- reason: связь равна блоку по весу линии, поэтому схема читается целиком

## TOK-scheme.arrow-shape — Форма связей
- value: auto
- nearest: TOK-scheme.arrow-width
- reason: прямая честнее показывает «отсюда сюда», а на схеме с ветвлениями
  режет её наискось; выбор по виду схемы снимает этот спор

## TOK-scheme.title-size — Размер подписи схемы
- value: 28
- nearest: TOK-scheme.stroke-width
- reason: подпись читается на общем плане доски, где блоки величиной с ноготь

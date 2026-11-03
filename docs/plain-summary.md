# Короткая сводка ЭКГ

В карточке пациента, на странице записи и в печатном отчёте показываются одинаковые семь пунктов: частота сердца, направление оси, патологические зубцы, наличие подъёма ST, ритм, внеочередные сокращения и отдельная предсердная активность. Сырые оценки и таблицы классов сохраняются в данных, но не показываются.

## Основания для текста

- ЧСС: сохранённый показатель прибора; 60–100/мин — ориентир для взрослого в покое, не детская норма. Возраст берётся на дату записи. Источник: https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/all-about-heart-rate-pulse
- Ось: направление сохранённой фронтальной оси; без произвольных степеней тяжести или вывода о положении верхушки сердца. Источник: https://ecg.utah.edu/lesson/2-1
- Данные моделей обозначают предположения, а не измеренные амплитуды, количество событий, тяжесть или отсутствие патологии. Оценка без опубликованного порога не превращается в бинарное заключение. Синтетические и явно относящиеся к другой записи результаты исключаются.
- Предсердная активность и сокращения желудочков — отдельные поля. Частота предсердий не копируется из ЧСС. Мерцательная аритмия и фибрилляция предсердий — одно название нарушения; трепетание — другое. Источник: https://ecg.utah.edu/lesson/5-2
- Подтип экстрасистол и частота не выводятся из общего классификационного балла; оценку короткой записи нельзя выдавать за суточную нагрузку. Источники: https://ecg.utah.edu/lesson/5-2 и https://ecg.utah.edu/lesson/5-3

## Проверенное заключение

`record.interpretation` имеет `schemaVersion: 1`, `basis: "clinician-reviewed"`, непустого `reviewedBy`, дату `reviewedAt` и `sourceSha256`, совпадающий с SHA-256 записи. Это явно проверенное заключение, а не автоматическая установка `verified` после инференса.

Поддерживаются:
- `axis.direction`: normal / left / right / extreme / anterior / posterior.
- `pathologicalWaves.status`, `stElevation.status`: present / absent / unknown.
- `rhythm.type`: sinus / atrial / junctional / ventricular / afib / flutter.
- `rhythm.atrialActivityRatePerMinute`, `rhythm.ventricularRatePerMinute` — отдельные измерения.
- `extrasystoles.status`; `type`: atrial / junctional / ventricular / mixed; `frequency`: rare / moderate / frequent — только с `frequencyScope: "recording"`; `pattern`: bigeminy / trigeminy / quadrigeminy / pairs / runs / irregular.

Отсутствующие поля остаются неопределёнными. В интерфейсе нет кнопки, автоматически подтверждающей оценки классификатора.

## Исследовательский расчёт по кривой

`record.waveformResearch` — отдельный объект: `schemaVersion: 1`, `basis: "waveform-research"`, `clinicalValidation: false`, `sourceSha256`, `method`, `assumptions.fs_hz`, `assumptions.microvolts_per_count`, `summary` с семью ключами `heartRate/axis/waves/st/rhythm/extrasystoles/atrial`. Сохраняет также метрики и допущения. Текст всегда явно предварительный; объект не заменяет проверенное заключение и не подтверждает калибровку. Несовпадающий SHA-256, неполный или некорректный объект не показывается.

Этот релиз отображает приложенный расчёт. Он **не включает универсальный автоматический диагностический алгоритм** для всех новых ЭКГ. Частота дискретизации, усиление, отведения, качество сигнала, положение P/QRS/J и применимость правил должны проверяться до клинических выводов. Алгоритмы поиска: https://wfdb.readthedocs.io/en/latest/processing.html и https://neuropsychology.github.io/NeuroKit/functions/ecg.html

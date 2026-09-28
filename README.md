# wishlist

Минималистичный личный вишлист. Один список на телефоне и компьютере, синхронизация через Vercel + Upstash Redis.

- пишешь одной строкой: `наушники sony https://… 32к` → название, ссылка и цена разбираются сами
- три точки = насколько хочется, кружок = сбылось, тап по желанию = редактировать
- ставится на телефон как приложение (PWA); на android можно «поделиться» ссылкой из любого магазина прямо в вишлист
- без интернета тоже работает: добавленное отправится, когда появится сеть
- 6 цветов акцента, светлая / тёмная тема

## Деплой в один клик

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fk1dbtw%2Fwishlist&project-name=wishlist&repository-name=wishlist-site&env=WISHLIST_KEY&envDescription=%D0%9F%D0%B0%D1%80%D0%BE%D0%BB%D1%8C%20%D0%B4%D0%BB%D1%8F%20%D0%B2%D1%85%D0%BE%D0%B4%D0%B0%20%D0%B2%20%D0%B2%D0%B8%D1%88%D0%BB%D0%B8%D1%81%D1%82%20%D0%BD%D0%B0%20%D1%82%D0%B2%D0%BE%D0%B8%D1%85%20%D1%83%D1%81%D1%82%D1%80%D0%BE%D0%B9%D1%81%D1%82%D0%B2%D0%B0%D1%85&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22upstash%22%2C%22productSlug%22%3A%22upstash-kv%22%2C%22protocol%22%3A%22storage%22%7D%5D)

Кнопка создаст проект на Vercel, спросит `WISHLIST_KEY` (пароль для входа) и подключит бесплатную базу Upstash Redis. Если база не подключилась сама, сделай шаг 4 из ручной инструкции ниже.

## Деплой на Vercel вручную (≈5 минут, бесплатно)

1. **vercel.com → Add New → Project** → импортируй репозиторий `wishlist`. Настройки сборки не трогай (фреймворк: Other).
2. До нажатия Deploy открой **Environment Variables** и добавь:
   - `WISHLIST_KEY` = любой длинный пароль (им входишь на устройствах)
3. **Deploy**.
4. В проекте: **Storage → Create Database → Upstash for Redis** (бесплатный план) → **Connect** к этому проекту. Vercel сам добавит `KV_REST_API_URL` и `KV_REST_API_TOKEN`.
5. **Deployments → ⋯ → Redeploy**, чтобы функция увидела новые переменные.
6. Открой `https://<твой-проект>.vercel.app` на компьютере и на телефоне, введи ключ.

На телефоне: Safari → «Поделиться» → «На экран Домой» (iPhone) или Chrome → «Установить приложение» (Android).

Если вместо входа видишь «сервер не настроен: нет …», значит не хватает названной переменной. Добавь её и сделай Redeploy.

## Устройство

```
index.html              разметка
style.css               стили (цвета — токены в :root)
app.js                  логика, офлайн-очередь, синхронизация (опрос раз в 10 с + при возврате во вкладку)
api/wishes.js           GET / POST / DELETE, проверка ключа, хранение в Redis-хеше wishlist:items
sw.js                   офлайн-кэш оболочки
manifest.webmanifest    PWA + share target
```

Без зависимостей и сборки. Ключ передаётся в заголовке `x-wishlist-key` и хранится в localStorage устройства.

# wishlist

Минималистичный личный вишлист. Один список на телефоне и компьютере, деплоится на Netlify или Vercel.

- пишешь одной строкой: `наушники sony https://… 32к` → название, ссылка и цена разбираются сами
- три точки = насколько хочется, кружок = сбылось, тап по желанию = редактировать
- ставится на телефон как приложение (PWA); на android можно «поделиться» ссылкой из любого магазина прямо в вишлист
- без интернета тоже работает: добавленное отправится, когда появится сеть
- 6 цветов акцента, светлая / тёмная тема

## Деплой

### Вариант 1: Netlify (проще всего, база не нужна)

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/k1dbtw/wishlist)

1. Нажми кнопку и войди через GitHub.
2. Впиши `WISHLIST_KEY`: пароль для входа, любой длинный.
3. Нажми **Save & Deploy** и подожди минуту.

Желания хранятся во встроенном хранилище Netlify (Blobs), отдельно подключать ничего не нужно.

### Вариант 2: Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fk1dbtw%2Fwishlist&project-name=wishlist&repository-name=wishlist-site&env=WISHLIST_KEY&envDescription=%D0%9F%D0%B0%D1%80%D0%BE%D0%BB%D1%8C%20%D0%B4%D0%BB%D1%8F%20%D0%B2%D1%85%D0%BE%D0%B4%D0%B0%20%D0%B2%20%D0%B2%D0%B8%D1%88%D0%BB%D0%B8%D1%81%D1%82%20%D0%BD%D0%B0%20%D1%82%D0%B2%D0%BE%D0%B8%D1%85%20%D1%83%D1%81%D1%82%D1%80%D0%BE%D0%B9%D1%81%D1%82%D0%B2%D0%B0%D1%85&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22upstash%22%2C%22productSlug%22%3A%22upstash-kv%22%2C%22protocol%22%3A%22storage%22%7D%5D)

1. Нажми кнопку, войди через GitHub, впиши `WISHLIST_KEY`, нажми **Deploy**.
2. Если сайт пишет «сервер не настроен: нет KV_REST_API_URL», значит база не подключилась сама: в проекте **Storage → Create Database → Upstash for Redis → Connect**, затем **Deployments → ⋯ → Redeploy**.

### После деплоя

Открой адрес сайта на компьютере и на телефоне и введи пароль. На телефоне добавь сайт на главный экран: Safari → «Поделиться» → «На экран Домой» (iPhone) или Chrome → «Установить приложение» (Android).

## Устройство

```
index.html              разметка
style.css               стили (цвета — токены в :root)
app.js                  логика, офлайн-очередь, синхронизация (опрос раз в 10 с + при возврате во вкладку)
lib/core.js             API: проверка ключа, валидация, GET / POST / DELETE
netlify/functions/      API на Netlify (хранилище Netlify Blobs)
api/wishes.js           API на Vercel (Upstash Redis, хеш wishlist:items)
sw.js                   офлайн-кэш оболочки
manifest.webmanifest    PWA + share target
```

Фронтенд без сборки и зависимостей; для Netlify нужен только пакет `@netlify/blobs`. Ключ передаётся в заголовке `x-wishlist-key` и хранится в localStorage устройства.

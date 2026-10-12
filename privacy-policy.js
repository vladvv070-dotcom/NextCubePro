/* Next Cube Pro privacy policy. Kept local so it is available offline and on every
 * deployment; the visible language follows the application's UI language. */
(function () {
    const policy = {
        en: {
            title: 'Next Cube Pro Privacy Policy',
            meta: 'Effective date: [insert publication date] · Website: https://nextcubepro.com · Contact: [insert a working project email address]',
            html: `
                <h3>1. Introduction</h3>
                <p>Next Cube Pro (“NCP”, “we”, “our”, or the “Service”) is an online speedcubing service that provides a timer, solve history, statistics, and a global leaderboard.</p>
                <p>This Privacy Policy explains what information may be processed when you use NCP, why it is processed, where it is stored, and how you can manage your information.</p>
                <h3>2. Information We Process</h3>
                <h4>2.1. Account information</h4>
                <p>When you register or sign in, the Service may process your UID, email address, display name, chosen nickname, sign-in method (email/password or Google), and technical account information provided by the authentication service. Passwords are handled by Firebase Authentication; NCP does not access or store them in plain text.</p>
                <h4>2.2. Solves and statistics</h4>
                <p>NCP may process solve times and dates, scrambles, disciplines and sessions, penalties (+2 and DNF), personal bests, averages, daily-scramble results and dates, achievements, progress, coins, titles, skins, rewards, settings, and information needed to synchronize the Service across devices.</p>
                <h4>2.3. Leaderboard information</h4>
                <p>For the global leaderboard, NCP may send a technical user identifier, public nickname and title, coins, streak, total solves, training time, personal bests, averages, current averages, and daily-scramble dates to a separate storage service. These details may be visible to website visitors. Do not put personal information in a public nickname. Complete solve history is not sent to Upstash Redis for leaderboard purposes; it is stored in Firebase Cloud Firestore.</p>
                <h4>2.4. Technical information</h4>
                <p>Requests may include IP address, browser/device information, request URL and path, date and time, response codes, and technical error messages. Infrastructure providers such as Cloudflare may process these details under their own configurations and retention policies.</p>
                <h3>3. Services and Data Storage</h3>
                <p>NCP uses Firebase Authentication, Firebase Cloud Firestore, Cloudflare Pages, Cloudflare Workers, Upstash Redis, and Google Sign-In. Source code is stored in GitHub; this does not by itself give GitHub users' solve histories. NCP currently does not use a separate website analytics service. Providers may process data in different countries under their own policies.</p>
                <h3>4. Local Browser Storage</h3>
                <p>NCP may store local sessions and solves, interface preferences, synchronization information, and queued operations in your browser. Signing out does not necessarily delete local sessions or solves, so take care on shared devices.</p>
                <h3>5. How We Use Information</h3>
                <p>Information is used to authenticate accounts, operate the timer, save solves, calculate statistics, synchronize devices, operate the leaderboard, maintain progress and rewards, protect the Service, diagnose errors, prevent abuse, and carry out user-requested actions. We do not claim to sell user profiles or provide solve histories to advertisers.</p>
                <h3>6. Account and Data Deletion</h3>
                <p>You can delete your account through NCP settings. The process is intended to delete the authentication account, related Firestore data, leaderboard entries, and corresponding local data. Deletion is irreversible. Signing out is not account deletion. Technical logs, backups, or provider-held records may remain for periods set by providers, their policies, or applicable law. Contact us if expected deletion does not complete.</p>
                <h3>7. Data Retention</h3>
                <p>Information is retained as long as needed for the relevant NCP features or until deletion, unless additional retention is required for legitimate technical or legal purposes. Retention periods for provider logs and backups depend on plans, configurations, and internal policies.</p>
                <h3>8. Data Security</h3>
                <p>HTTPS and secure connections are used where supported. Server-side credentials, including the Upstash Redis token, must remain in server-side secrets and are not included in client-side JavaScript. No method can guarantee absolute security.</p>
                <h3>9. Cookies and Advertising Technologies</h3>
                <p>NCP uses browser storage and authentication mechanisms needed to operate the Service. If Google AdSense is enabled, Google and its partners may use cookies and similar technologies subject to applicable settings, consent, and Google's policies. See <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>.</p>
                <h3>10. User Rights</h3>
                <p>Depending on applicable law, you may request access, correction, deletion, withdrawal of consent where applicable, or lodge a complaint with a data protection authority. Contact us for requests that cannot be handled in the interface.</p>
                <h3>11. Changes to This Policy</h3>
                <p>This policy may be updated as NCP, its providers, or legal requirements change. The current version is published with its effective date.</p>
                <h3>12. Contact</h3>
                <p>Next Cube Pro<br>Email: [insert a working project email address]<br>Website: https://nextcubepro.com</p>`
        },
        ru: {
            title: 'Политика конфиденциальности Next Cube Pro',
            meta: 'Дата вступления в силу: [укажите дату публикации] · Сайт: https://nextcubepro.com · Контакт: [укажите рабочий адрес электронной почты проекта]',
            html: `
                <h3>1. Общие положения</h3>
                <p>Next Cube Pro (NCP, «сайт» или «сервис») — онлайн-сервис для спидкубинга с таймером, историей сборок, статистикой и глобальной таблицей лидеров.</p>
                <p>Политика объясняет, какие данные обрабатываются, для чего они нужны, где хранятся и как ими управлять.</p>
                <h3>2. Какие данные мы обрабатываем</h3>
                <h4>2.1. Данные аккаунта</h4>
                <p>При регистрации или входе могут обрабатываться UID, адрес электронной почты, отображаемое имя и никнейм, способ входа (почта/пароль или Google), а также технические сведения сервиса аутентификации. Пароли обрабатывает Firebase Authentication; NCP не получает и не хранит их в открытом виде.</p>
                <h4>2.2. Результаты сборок и статистика</h4>
                <p>Могут обрабатываться время и дата сборок, скрамблы, дисциплины и сессии, штрафы (+2 и DNF), личные рекорды, средние значения, результаты и даты ежедневных скрамблов, достижения, прогресс, монеты, титулы, скины, награды, настройки и данные для синхронизации между устройствами.</p>
                <h4>2.3. Данные таблицы лидеров</h4>
                <p>Для глобального рейтинга NCP может передавать технический идентификатор, публичный никнейм и титул, монеты, серию, число сборок, тренировочное время, рекорды, средние значения, текущие средние и даты ежедневных скрамблов. Эти сведения могут быть видны посетителям сайта — не указывайте в публичном нике личные данные. Полная история сборок не передаётся в Upstash Redis для рейтинга и хранится в Firebase Cloud Firestore.</p>
                <h4>2.4. Технические данные</h4>
                <p>В запросах могут обрабатываться IP-адрес, сведения о браузере и устройстве, URL и путь запроса, дата и время, коды ответа и технические сообщения об ошибках. Инфраструктурные провайдеры, включая Cloudflare, могут обрабатывать их по своим настройкам и срокам хранения.</p>
                <h3>3. Где хранятся данные</h3>
                <p>NCP использует Firebase Authentication, Firebase Cloud Firestore, Cloudflare Pages, Cloudflare Workers, Upstash Redis и Google Sign-In. Исходный код хранится в GitHub; это само по себе не передаёт GitHub историю сборок пользователей. В текущей конфигурации отдельный сервис веб-аналитики не используется. Провайдеры могут обрабатывать данные в разных странах по собственным политикам.</p>
                <h3>4. Локальное хранение в браузере</h3>
                <p>NCP может хранить в браузере локальные сессии и сборки, настройки интерфейса, сведения синхронизации и очередь неотправленных операций. Выход из аккаунта не обязательно удаляет локальные сессии и сборки, поэтому на общем устройстве нужно самостоятельно защищать эти данные.</p>
                <h3>5. Для чего используются данные</h3>
                <p>Данные нужны для входа, работы таймера, сохранения сборок, расчёта статистики, синхронизации, таблицы лидеров, прогресса и наград, защиты сервиса, диагностики ошибок, предотвращения злоупотреблений и выполнения действий пользователя. Мы не заявляем о продаже профилей или передаче истории сборок рекламодателям.</p>
                <h3>6. Удаление аккаунта и данных</h3>
                <p>Аккаунт можно удалить через настройки NCP. Процесс предназначен для удаления аккаунта аутентификации, связанных данных Firestore, записей в таблице лидеров и соответствующих локальных данных. Удаление необратимо. Выход из аккаунта не равнозначен удалению. Технические журналы, резервные копии и записи у провайдеров могут сохраняться по их настройкам, политикам и требованиям закона. Если удаление не завершилось, обратитесь к нам.</p>
                <h3>7. Сроки хранения</h3>
                <p>Данные хранятся столько, сколько нужно для функций NCP, либо до удаления, если дополнительное хранение не требуется по техническим или юридическим причинам. Сроки хранения журналов и резервных копий провайдеров зависят от тарифов, настроек и внутренних правил.</p>
                <h3>8. Защита данных</h3>
                <p>Для передачи используются HTTPS и защищённые соединения там, где это предусмотрено интеграцией. Серверные секреты, включая токен Upstash Redis, хранятся только на сервере и не включаются в клиентский JavaScript. Абсолютная безопасность не гарантируется.</p>
                <h3>9. Файлы cookie и реклама</h3>
                <p>NCP использует браузерное хранилище и аутентификацию, необходимые для работы. При включении Google AdSense Google и партнёры могут применять cookie и аналогичные технологии с учётом настроек и согласия пользователя. Подробнее: <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Политика конфиденциальности Google</a>.</p>
                <h3>10. Права пользователей</h3>
                <p>В зависимости от закона пользователь может запросить доступ, исправление или удаление данных, отозвать согласие в применимых случаях либо обратиться в компетентный орган. Для остальных запросов свяжитесь с нами.</p>
                <h3>11. Изменения политики</h3>
                <p>Политика может обновляться при изменении NCP, провайдеров или законодательства. Актуальная версия публикуется с датой вступления в силу.</p>
                <h3>12. Контакты</h3>
                <p>Next Cube Pro<br>Электронная почта: [укажите рабочий адрес электронной почты проекта]<br>Сайт: https://nextcubepro.com</p>`
        }
    };

    window.NextCubeProPrivacyPolicy = {
        get(lang) { return policy[lang === 'ru' ? 'ru' : 'en']; }
    };
})();

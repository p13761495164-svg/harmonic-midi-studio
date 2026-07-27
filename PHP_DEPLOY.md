# Harmonic MIDI Player — PHP + MySQL 部署

## 服务器要求

- PHP 8.1 或更高
- PHP 扩展：`pdo_mysql`
- MySQL 8 / MariaDB 10.5 或更高
- Nginx 或 Apache
- HTTPS（Web Audio 和浏览器文件功能建议使用）

## 1. 创建数据库

创建一个 UTF-8 数据库和独立用户，然后导入 `database.sql`：

```sql
CREATE DATABASE harmonic_midi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'harmonic_midi'@'localhost' IDENTIFIED BY '请换成长密码';
GRANT SELECT, INSERT, UPDATE ON harmonic_midi.* TO 'harmonic_midi'@'localhost';
FLUSH PRIVILEGES;
```

```bash
mysql -u root -p harmonic_midi < database.sql
```

## 2. 配置 PHP

复制配置文件，并放在网站公开目录的上一层：

```bash
cp config.example.php config.php
```

修改 `config.php` 中的数据库信息。`admin_key` 请使用至少 32 位的随机字符串，例如：

```bash
openssl rand -hex 32
```

`config.php` 不能放进 `public/`，也不要提交到 Git。

## 3. 配置网站目录

将整个 `php-dist` 上传到服务器，例如：

```text
/var/www/harmonic-midi/
├── config.php
├── database.sql
└── public/       ← 网站根目录
```

Nginx 的 `root` 必须指向 `/var/www/harmonic-midi/public`。PHP location 示例：

```nginx
server {
    listen 80;
    server_name midi.example.cn;
    root /var/www/harmonic-midi/public;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~ \.php$ {
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_pass unix:/run/php/php8.2-fpm.sock;
    }
}
```

Apache 可直接使用 `public/.htaccess`，并将 DocumentRoot 指向 `public/`。

## 4. 检查

访问：

- `/api/health.php`：应返回 `{"ok":true,"database":true,"instruments":128}`
- `/timbres/`：音色管理
- `/`：MIDI 播放器

第一次访问 API 时，会自动向空表补齐 128 个 General MIDI 乐器。

## 管理安全

- 读取音色和收藏列表为公开接口，播放器需要使用。
- 修改参数、收藏或取消收藏必须提供 `config.php` 中的管理密钥。
- 管理页只把密钥保存在当前浏览器会话，关闭标签页后失效。
- 建议使用 HTTPS，并通过防火墙只开放 80/443 端口。

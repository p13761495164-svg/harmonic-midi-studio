# Harmonic MIDI — personalApp 子应用部署

目标位置：

```text
/www/wwwroot/myApps.com/apps/harmonic-midi/
```

访问路径：

```text
/apps/harmonic-midi/
/apps/harmonic-midi/timbres/
```

## 与 personalApp 的集成

- 数据库连接直接读取站点现有的 `/shared/database.php`，不会复制或公开 MySQL 密码。
- 音色数据保存在独立表 `harmonic_instrument_presets`。
- 安装脚本会把 `Harmonic MIDI` 写入现有 `applist_apps`。
- 音色管理密钥保存在子应用自己的 `config.php`，首次部署自动随机生成，后续发布会保留。
- 静态资源使用 `/apps/harmonic-midi` 作为 base path。

## 构建

```bash
npm run build:php
```

发布内容位于：

```text
php-dist/apps/harmonic-midi/
```

## scoped 部署

部署脚本读取 personalApp 项目已有的 `.deploy.env`，只替换
`apps/harmonic-midi/`，不会覆盖整站：

```bash
./deploy-personalapp.sh
```

先查看将上传什么：

```bash
./deploy-personalapp.sh --dry-run
```

部署会在服务器端执行 PHP 语法检查、创建/升级音色表、注册应用列表，
再原子切换目录。旧版本保留为带时间戳的 backup，便于回滚。

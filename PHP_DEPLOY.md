# Harmonic MIDI — personalApp 子应用部署

目标位置：

```text
/www/wwwroot/myApps.com/apps/harmonic-midi/
```

访问路径：

```text
/apps/harmonic-midi/
/apps/harmonic-midi/timbres/
/apps/harmonic-midi/custom-timbres/
```

## 与 personalApp 的集成

- 数据库连接直接读取站点现有的 `/shared/database.php`，不会复制或公开 MySQL 密码。
- 音色数据保存在独立表 `harmonic_instrument_presets`。
- Custom 音色和 GM 映射分别保存在 `harmonic_custom_timbres` 与 `harmonic_program_mappings`。
- 首次升级会把原有 001/047 卡林巴参数迁移到 Custom 库，再恢复标准 GM 参数。
- 安装脚本会把 `Harmonic MIDI` 写入现有 `applist_apps`。
- 音色参数和收藏可直接保存到 MySQL，不再需要管理密钥。
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

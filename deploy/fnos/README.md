# 飞牛 OS 局域网音乐服务

部署地址：`http://192.168.3.3:4533`

音乐目录以只读方式挂载：

- 飞牛路径：`/vol1/1000/music`
- 容器路径：`/music`

服务数据保存在 `/vol1/1000/yungan-music/data`，不会写入或删除同步目录中的歌曲。

当前使用 Docker Compose 服务（镜像来自官方 GHCR）。常用维护命令：

```sh
cd /vol1/1000/yungan-music
sudo docker compose ps
sudo docker compose logs --tail=100
sudo docker compose restart
sudo docker compose pull
sudo docker compose up -d
```

原生二进制和 systemd 服务已经移除。

// S11 尊者配对 · 微后端
//
// 提供留言板和阵容投稿 API，并托管打包进二进制的前端（public/，构建时由 dist/ 复制而来）。
// 环境变量：
//
//	ADDR         监听地址，默认 :8080
//	DATA_DIR     数据目录，默认 ./data（Docker 中为 /data）
//	ADMIN_USER      站长用户名，默认 admin
//	ADMIN_PASSWORD  站长口令（至少 12 位）；启动时自动创建/同步站长账号，站长可在后台添加其他管理员。
//	                为空且数据里没有管理员时，所有管理功能不可用
//	STATIC_DIR   可选，从磁盘目录托管前端（本地调试用），覆盖内嵌文件
//	TRUST_PROXY  设为 1 时按 X-Forwarded-For 识别客户端 IP（放在反向代理后面时开启）
package main

import (
	"context"
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path"
	"strings"
	"syscall"
	"time"
)

//go:embed all:public
var embedded embed.FS

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	healthcheck := flag.Bool("healthcheck", false, "请求本机 /api/health 后退出（供 Docker HEALTHCHECK 使用）")
	flag.Parse()
	addr := env("ADDR", ":8080")
	if *healthcheck {
		os.Exit(runHealthcheck(addr))
	}

	store, err := OpenStore(env("DATA_DIR", "./data"))
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	if pw := os.Getenv("ADMIN_PASSWORD"); pw != "" {
		if len(pw) < 12 {
			log.Fatal("ADMIN_PASSWORD 至少 12 位")
		}
		name := env("ADMIN_USER", "admin")
		if err := store.EnsureOwner(name, pw); err != nil {
			log.Fatalf("create owner: %v", err)
		}
		log.Printf("站长账号：%s", name)
	} else if len(store.Admins()) == 0 {
		log.Print("ADMIN_PASSWORD 未设置且没有管理员账号：审核、回复、删除等管理功能不可用")
	}
	api, err := NewAPI(store, os.Getenv("TRUST_PROXY") == "1")
	if err != nil {
		log.Fatal(err)
	}

	var static fs.FS
	if dir := os.Getenv("STATIC_DIR"); dir != "" {
		static = os.DirFS(dir)
	} else {
		static, _ = fs.Sub(embedded, "public")
	}

	mux := http.NewServeMux()
	api.Routes(mux)
	mux.Handle("/", spa(static))

	srv := &http.Server{
		Addr:              addr,
		Handler:           securityHeaders(mux),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
	}
	go func() {
		log.Printf("listening on %s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
}

// spa 托管静态文件；找不到的非 /api 路径回退到 index.html
func spa(static fs.FS) http.Handler {
	files := http.FileServerFS(static)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}
		if _, err := fs.Stat(static, p); err != nil {
			r = r.Clone(r.Context())
			r.URL.Path = "/"
			p = "index.html"
		}
		if strings.HasPrefix(p, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	})
}

func securityHeaders(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		h.ServeHTTP(w, r)
	})
}

func runHealthcheck(addr string) int {
	host := addr
	if strings.HasPrefix(host, ":") {
		host = "127.0.0.1" + host
	}
	c := http.Client{Timeout: 3 * time.Second}
	resp, err := c.Get("http://" + host + "/api/health")
	if err != nil || resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

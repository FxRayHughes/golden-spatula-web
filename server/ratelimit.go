package main

import (
	"sync"
	"time"
)

// RateLimiter 按 IP 做滑动窗口限流：window 内最多 max 次，且两次之间至少间隔 gap。
type RateLimiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	gap    time.Duration
	hits   map[string][]time.Time
}

func NewRateLimiter(max int, window, gap time.Duration) *RateLimiter {
	return &RateLimiter{max: max, window: window, gap: gap, hits: map[string][]time.Time{}}
}

// Allow 返回是否放行；不放行时同时返回建议的等待时间
func (r *RateLimiter) Allow(ip string) (bool, time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	h := r.hits[ip]
	i := 0
	for i < len(h) && now.Sub(h[i]) > r.window {
		i++
	}
	h = h[i:]
	if len(h) > 0 && now.Sub(h[len(h)-1]) < r.gap {
		r.hits[ip] = h
		return false, r.gap - now.Sub(h[len(h)-1])
	}
	if len(h) >= r.max {
		r.hits[ip] = h
		return false, r.window - now.Sub(h[0])
	}
	r.hits[ip] = append(h, now)
	if len(r.hits) > 10000 {
		r.gcLocked(now)
	}
	return true, 0
}

func (r *RateLimiter) gcLocked(now time.Time) {
	for ip, h := range r.hits {
		if len(h) == 0 || now.Sub(h[len(h)-1]) > r.window {
			delete(r.hits, ip)
		}
	}
}

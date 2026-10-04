package com.music.player;

import java.io.IOException;
import java.util.function.Function;

/** Keeps recoverable Google service failures distinct from a request for user consent. */
final class GoogleAuthFailure extends IOException {
    final String code;

    private GoogleAuthFailure(String message, String code, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    static GoogleAuthFailure required() {
        return new GoogleAuthFailure("Google 授权需要重新确认，请重新连接账号。", "GOOGLE_AUTH_REQUIRED", null);
    }

    static GoogleAuthFailure cancelled() {
        return new GoogleAuthFailure("Google 登录已取消。", "GOOGLE_LOGIN_CANCELLED", null);
    }

    static GoogleAuthFailure temporary() {
        return new GoogleAuthFailure("Google 连接暂时失败，已保留登录信息，请检查网络后重试。", "GOOGLE_AUTH_TEMPORARY", null);
    }

    static GoogleAuthFailure from(Throwable error, Function<Throwable, Integer> statusCode) {
        Throwable current = error;
        for (int depth = 0; current != null && depth < 16; depth++, current = current.getCause()) {
            if (current instanceof GoogleAuthFailure) return (GoogleAuthFailure) current;
            Integer status = statusCode.apply(current);
            // Google CommonStatusCodes: SIGN_IN_REQUIRED=4, DEVELOPER_ERROR=10, CANCELED=16.
            if (status != null && status == 4) return required();
            if (status != null && status == 16) return cancelled();
            if (status != null && status == 10) {
                return new GoogleAuthFailure("Google 应用配置无效，请检查 Google Play 服务和 OAuth 配置。", "GOOGLE_CONFIG_REQUIRED", error);
            }
        }
        return new GoogleAuthFailure(temporary().getMessage(), "GOOGLE_AUTH_TEMPORARY", error);
    }
}

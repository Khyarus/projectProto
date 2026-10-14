// Ponte JNI do llama.cpp para o app (com.protogen.kiosk.Llm).
// Uma conversa por vez. A cada pedido o Kotlin manda o histórico inteiro; os tokens que já
// estão no cache KV (prefixo igual ao pedido anterior) são reaproveitados, então só o
// trecho novo é processado.

#include <android/log.h>
#include <jni.h>

#include <atomic>
#include <string>
#include <vector>

#include "chat.h"
#include "common.h"
#include "llama.h"
#include "sampling.h"

#define TAG "ProtoLLM"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

static llama_model * g_model = nullptr;
static llama_context * g_ctx = nullptr;
static common_chat_templates_ptr g_tmpls;
static std::vector<llama_token> g_past;  // tokens que estão no cache KV, na ordem
static std::atomic<bool> g_cancel{false};
static int g_n_batch = 512;

static void log_cb(ggml_log_level level, const char * text, void *) {
    int prio = level == GGML_LOG_LEVEL_ERROR ? ANDROID_LOG_ERROR
             : level == GGML_LOG_LEVEL_WARN  ? ANDROID_LOG_WARN
             : ANDROID_LOG_DEBUG;
    __android_log_write(prio, "llama", text);
}

static jstring jstr(JNIEnv * env, const std::string & s) { return env->NewStringUTF(s.c_str()); }

static std::string to_std(JNIEnv * env, jstring js) {
    const char * c = env->GetStringUTFChars(js, nullptr);
    std::string s(c);
    env->ReleaseStringUTFChars(js, c);
    return s;
}

// Verdadeiro se a string termina com um caractere UTF-8 completo
static bool utf8_complete(const std::string & s) {
    int i = (int) s.size() - 1, n = 0;
    while (i >= 0 && n < 4 && ((unsigned char) s[i] & 0xC0) == 0x80) { i--; n++; }
    if (i < 0) return n == 0;
    unsigned char c = (unsigned char) s[i];
    int need = (c & 0x80) == 0 ? 0 : (c & 0xE0) == 0xC0 ? 1 : (c & 0xF0) == 0xE0 ? 2 : (c & 0xF8) == 0xF0 ? 3 : 0;
    return n == need;
}

static void unload() {
    g_tmpls.reset();
    if (g_ctx) { llama_free(g_ctx); g_ctx = nullptr; }
    if (g_model) { llama_model_free(g_model); g_model = nullptr; }
    g_past.clear();
}

extern "C" JNIEXPORT void JNICALL
Java_com_protogen_kiosk_Llm_nativeInit(JNIEnv *, jobject) {
    llama_log_set(log_cb, nullptr);
    llama_backend_init();
    LOGI("%s", llama_print_system_info());
}

/** Carrega o modelo. Retorna null se deu certo, ou a mensagem de erro. */
extern "C" JNIEXPORT jstring JNICALL
Java_com_protogen_kiosk_Llm_nativeLoad(JNIEnv * env, jobject, jstring jpath, jint n_ctx, jint n_threads) {
    unload();
    const std::string path = to_std(env, jpath);

    llama_model_params mp = llama_model_default_params();
    g_model = llama_model_load_from_file(path.c_str(), mp);
    if (!g_model) return jstr(env, "falha ao abrir o modelo");

    llama_context_params cp = llama_context_default_params();
    cp.n_ctx = n_ctx;
    cp.n_batch = g_n_batch;
    cp.n_ubatch = g_n_batch;
    cp.n_threads = n_threads;
    cp.n_threads_batch = n_threads;
    g_ctx = llama_init_from_model(g_model, cp);
    if (!g_ctx) { unload(); return jstr(env, "falha ao criar o contexto"); }

    g_tmpls = common_chat_templates_init(g_model, "");
    LOGI("modelo carregado: %s, ctx %d, threads %d", path.c_str(), n_ctx, n_threads);
    return nullptr;
}

extern "C" JNIEXPORT void JNICALL
Java_com_protogen_kiosk_Llm_nativeCancel(JNIEnv *, jobject) { g_cancel = true; }

extern "C" JNIEXPORT void JNICALL
Java_com_protogen_kiosk_Llm_nativeUnload(JNIEnv *, jobject) { unload(); }

static int decode(const std::vector<llama_token> & toks, size_t from, common_batch & batch) {
    for (size_t i = from; i < toks.size(); i += g_n_batch) {
        const size_t n = std::min(toks.size() - i, (size_t) g_n_batch);
        batch.clear();
        for (size_t j = 0; j < n; j++) {
            const bool last = i + j == toks.size() - 1;
            batch.add(toks[i + j], (llama_pos) (i + j), 0, last);
        }
        if (llama_process(g_ctx, LLAMA_PROCESS_TYPE_DECODE, batch.get()) != 0) return 1;
        if (g_cancel) return 2;
    }
    return 0;
}

/**
 * Gera a resposta para o histórico (roles[i], contents[i]), chamando sink.onToken(String)
 * a cada pedaço de texto. Retorna null se terminou bem, ou a mensagem de erro.
 */
extern "C" JNIEXPORT jstring JNICALL
Java_com_protogen_kiosk_Llm_nativeGenerate(JNIEnv * env, jobject, jobjectArray jroles, jobjectArray jcontents,
                                           jint max_tokens, jfloat temp, jobject sink) {
    if (!g_ctx) return jstr(env, "modelo não carregado");
    g_cancel = false;

    jclass sink_cls = env->GetObjectClass(sink);
    jmethodID on_token = env->GetMethodID(sink_cls, "onToken", "(Ljava/lang/String;)V");

    // ---- monta o prompt com o template de chat do próprio modelo ----
    common_chat_templates_inputs in;
    const jsize n = env->GetArrayLength(jroles);
    for (jsize i = 0; i < n; i++) {
        common_chat_msg m;
        m.role = to_std(env, (jstring) env->GetObjectArrayElement(jroles, i));
        m.content = to_std(env, (jstring) env->GetObjectArrayElement(jcontents, i));
        in.messages.push_back(m);
    }
    in.add_generation_prompt = true;
    in.enable_thinking = false;  // modelos com "raciocínio" (Qwen3) respondem direto

    std::string prompt;
    try {
        in.use_jinja = true;
        prompt = common_chat_templates_apply(g_tmpls.get(), in).prompt;
    } catch (const std::exception & e) {
        LOGW("template jinja falhou (%s), usando o simples", e.what());
        in.use_jinja = false;
        prompt = common_chat_templates_apply(g_tmpls.get(), in).prompt;
    }

    const std::vector<llama_token> toks = common_tokenize(g_ctx, prompt, true, true);
    const int n_ctx = (int) llama_n_ctx(g_ctx);
    if ((int) toks.size() + max_tokens >= n_ctx) return jstr(env, "conversa longa demais, use /limpar");

    // ---- reaproveita o prefixo que já está no cache ----
    size_t keep = 0;
    while (keep < g_past.size() && keep < toks.size() && g_past[keep] == toks[keep]) keep++;
    if (keep == toks.size() && keep > 0) keep--;  // reprocessa o último para ter os logits
    llama_memory_seq_rm(llama_get_memory(g_ctx), 0, (llama_pos) keep, -1);
    g_past.assign(toks.begin(), toks.begin() + keep);

    common_batch batch(g_ctx);
    const int64_t t0 = ggml_time_us();
    int rc = decode(toks, keep, batch);
    if (rc == 2) { g_past.clear(); llama_memory_clear(llama_get_memory(g_ctx), false); return nullptr; }
    if (rc != 0) { g_past.clear(); llama_memory_clear(llama_get_memory(g_ctx), false); return jstr(env, "falha ao processar o pedido"); }
    g_past = toks;
    const int64_t t1 = ggml_time_us();

    // ---- amostragem ----
    common_params_sampling sp;
    sp.temp = temp;
    sp.top_k = 40;
    sp.top_p = 0.9f;
    sp.penalty_repeat = 1.1f;
    common_sampler * smpl = common_sampler_init(g_model, sp);
    const llama_vocab * vocab = llama_model_get_vocab(g_model);

    std::string pending;
    int generated = 0;
    jstring err = nullptr;
    while (generated < max_tokens && !g_cancel) {
        const llama_token id = common_sampler_sample(smpl, g_ctx, -1);
        common_sampler_accept(smpl, id, true);
        if (llama_vocab_is_eog(vocab, id)) break;

        pending += common_token_to_piece(g_ctx, id);
        if (utf8_complete(pending)) {
            jstring piece = jstr(env, pending);
            env->CallVoidMethod(sink, on_token, piece);
            env->DeleteLocalRef(piece);
            pending.clear();
        }

        if ((int) g_past.size() + 1 >= n_ctx) break;
        batch.clear();
        batch.add(id, (llama_pos) g_past.size(), 0, true);
        if (llama_process(g_ctx, LLAMA_PROCESS_TYPE_DECODE, batch.get()) != 0) {
            err = jstr(env, "falha ao gerar");
            break;
        }
        g_past.push_back(id);
        generated++;
    }
    common_sampler_free(smpl);

    const int64_t t2 = ggml_time_us();
    LOGI("prompt %d tok (%zu novos) %.1f tok/s | resposta %d tok %.1f tok/s",
         (int) toks.size(), toks.size() - keep, (toks.size() - keep) / ((t1 - t0) / 1e6),
         generated, generated / ((t2 - t1) / 1e6 + 1e-9));
    return err;
}

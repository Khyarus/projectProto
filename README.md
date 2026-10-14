# Protogen

Transforma um celular Android (alvo: Samsung Galaxy A34) em um assistente de IA dedicado,
com cara de visor Protogen: olhos de LED que piscam, pensam e falam, e voz de sintetizador
robótico estilo **SAM (Software Automatic Mouth, 1982)**.

Roda no Android de fábrica: sem root, sem desbloquear bootloader.

## Estrutura

```
web/        Interface (HTML/Canvas/JS) — olhos, voz SAM, CLI. Roda no navegador ou dentro do app.
android/    App Kotlin: WebView com a interface, voz nativa, modo quiosque e atualizador.
```

## Testar a interface no PC

```
cd web
python -m http.server 8765
```

Abra http://127.0.0.1:8765 e clique uma vez para liberar o som. Digite `/ajuda` para ver os comandos.

Para usar um LLM de verdade no PC (ex.: `llama-server` do llama.cpp):

```
/llm http://127.0.0.1:8080
```

## Compilar o app

Precisa de JDK 17 e Android SDK (`local.properties` com `sdk.dir`).

```
cd android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

A assinatura usa uma chave definida em `~/.gradle/gradle.properties` (fora do repositório):

```
protogen.storeFile=C:/caminho/protogen-release.jks
protogen.storePassword=...
protogen.keyAlias=protogen
protogen.keyPassword=...
protogen.kioskPin=1982
```

> Guarde backup da chave. Sem ela o celular não aceita atualizações e é preciso desinstalar e reinstalar.

## Modo quiosque (dono do aparelho)

O app vira a única coisa do celular. Exige um aparelho **sem nenhuma conta** (logo após o reset de fábrica):

1. Reset de fábrica. No setup inicial, **não** adicione conta Google.
2. Ative Opções do desenvolvedor → Depuração USB.
3. No PC:
   ```
   adb install app-release.apk
   adb shell dpm set-device-owner com.protogen.kiosk/.AdminReceiver
   ```
4. Abra o app. Ele trava a tela, vira a tela inicial, desliga a tela de bloqueio e libera o microfone sozinho.

Saídas de emergência (digitadas na CLI do app):

- `/sair <pin>`: destrava até o app ser reaberto.
- `/liberar <pin>`: o app deixa de ser dono do aparelho (depois dá para desinstalar).

## Atualização automática

O app consulta `https://api.github.com/repos/<repo>/releases/latest` ao abrir e a cada 6 horas.
Se a tag (ex.: `v0.2.0`) for maior que a versão instalada, baixa o `.apk` anexado à release e instala.
Como dono do aparelho a instalação é silenciosa.

- O repositório é definido em `android/gradle.properties` → `protogen.updateRepo=dono/nome`.
- A versão do app fica em `protogen.version`.
- O repositório precisa ser **público** para o app enxergar as releases sem token.

## Voz SAM e aviso sobre licença

A voz usa o [sam-js](https://github.com/discordier/sam) (`web/vendor/samjs.min.js`), um port em
JavaScript do SAM, software comercial de 1982 da Don't Ask Software (hoje SoftVoice, Inc.).

**O SAM não tem licença de código aberto.** O código foi obtido por engenharia reversa e é tratado como
*abandonware*: a empresa detentora dos direitos não responde há anos, mas os direitos ainda existem.
O autor do port declara que não pode colocá-lo sob licença alguma e que o uso é por conta e risco de
quem usa. Por isso:

- este projeto inclui o arquivo apenas para uso pessoal e não comercial;
- quem fizer fork ou redistribuir deve estar ciente desse status;
- se a SoftVoice (ou sucessora) pedir a remoção, o arquivo sai do repositório.

O SAM só conhece fonemas do inglês. O arquivo `web/js/ptsam.js` converte português para esses
fonemas (com regras de acento tônico e timbre aberto/fechado do e/o), então o sotaque é de robô
gringo — intencional.

## Roadmap

- [x] Interface do visor com emoções e estados
- [x] Voz SAM em português
- [x] App Android com WebView, voz nativa (STT), quiosque e atualizador
- [ ] LLM local (llama.cpp embutido via JNI) + download do modelo
- [ ] Ferramentas do agente: busca web, data/hora, status do sistema

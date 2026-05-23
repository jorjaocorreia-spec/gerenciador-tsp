# Guia de Configuração: Google Calendar API (Sincronização Real)

A sincronização real com o Google Calendar foi implementada utilizando a biblioteca oficial do Google (GAPI) e o Google Identity Services (GIS). 

Por se tratar de uma aplicação Vanilla JS que roda diretamente no navegador, **você precisa gerar suas próprias credenciais no Google Cloud Console** para que a comunicação funcione.

Siga este passo a passo:

## 1. Criar um Projeto no Google Cloud
1. Acesse o [Google Cloud Console](https://console.cloud.google.com/).
2. Faça login com sua conta do Google.
3. No painel superior esquerdo, clique em "Selecionar um projeto" e depois em **Novo Projeto**.
4. Dê um nome ao seu projeto (ex: `TSP Manager Sync`) e clique em **Criar**.

## 2. Ativar a API do Google Calendar
1. No menu principal (hambúrguer) do Google Cloud, vá em **APIs e Serviços** > **Biblioteca**.
2. Na barra de pesquisa, digite **Google Calendar API**.
3. Clique no resultado esperado e depois clique no botão azul **Ativar**.

## 3. Configurar a Tela de Consentimento OAuth
1. Vá em **APIs e Serviços** > **Tela de consentimento OAuth**.
2. Selecione **Externo** (se quiser testar com qualquer conta Google) e clique em **Criar**.
3. Preencha os campos obrigatórios (Nome do App, Email de suporte do usuário, e Email de contato do desenvolvedor) e clique em **Salvar e Continuar**.
4. Em "Escopos", você precisa adicionar o escopo da agenda. Clique em **Adicionar ou remover escopos**, procure por `.../auth/calendar.events` e confirme. Avance até o fim do assistente salvando.
5. Em "Usuários de teste", **adicione o seu email pessoal do Google** que será utilizado no calendário, para que você possa logar enquanto o app não está "Aprovado e publicado" pelo Google.

## 4. Criar as Credenciais (Client ID e API Key)
1. Vá no menu esquerdo e clique em **Credenciais**.

### Gerar API Key:
2. Clique em **+ CRIAR CREDENCIAIS** > **Chave de API**.
3. Uma chave será gerada. Copie-a (NÃO a publique na internet!).
4. *(Opcional)* Clique em "Restringir Chave" e limite-a para a "Google Calendar API" e para restrições de HTTP Referrers colocando `http://localhost/*` (ou sua URL local/produção).

### Gerar Client ID:
5. Clique em **+ CRIAR CREDENCIAIS** > **ID do cliente OAuth**.
6. Selecione o tipo de aplicativo como **Aplicativo da Web**.
7. Dê um nome (ex: `Cliente Web TSP`).
8. Na seção **Origens JavaScript autorizadas**, clique em "Adicionar URI" e coloque a URL de onde você roda o seu app. Exemplo: 
   - `http://localhost`
   - `http://localhost:5500`
   > *(Se você acessa pelo arquivo direto `file://`, o Google OAuth bloqueia esse tipo de requisição. Você deve rodar o GerenciadorTSP por um live server local como Live Server do VSCode).*
9. Clique em **Criar**.
10. Copie o **ID do cliente** gerado.

## 5. Inserir Credenciais no Código
1. Abra o arquivo localizado em `d:\GerenciadorTSP\js\calendar.js` no seu editor.
2. Nas linhas iniciais, substitua as consts:

```javascript
const CLIENT_ID = 'COLE_AQUI_O_SEU_CLIENT_ID_GERADO'; 
const API_KEY = 'COLE_AQUI_A_SUA_API_KEY_GERADA';    
```

3. Salve o arquivo e recarregue a aplicação.

---

### Como a Sincronização Funciona Agora:
- **PULL Manual**: Ao abrir a aba **Agenda**, você pode clicar no botão **Sincronizar Google**. O sistema solicitará sua permissão (Flow do OAuth de Login do Google) e fará o download de todos os seus eventos da Agenda Principal dos últimos 30 dias até próximos 30 dias, injetando-os no TSP.
- **PUSH Automático**: De agora em diante, **qualquer novo evento criado ou editado** na aba da Agenda do _GerenciadorTSP_ com o checkbox "Sincronizar com Google Calendar" marcado, subirá a alteração de imediato para sua nuvem do Google automaticamente.

Ao logar uma vez, seu navegador armazenará o Token validamente por um tempo, dispensando a necessidade de re-autorizar a cada cadastro!

@echo off
title Gerenciador TSP
echo.
echo  ============================================
echo    Gerenciador TSP - Iniciando servidor...
echo  ============================================
echo.

REM Verifica se Python está disponível
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Python nao encontrado.
    echo Por favor, instale o Python em: https://www.python.org/downloads/
    pause
    exit /b 1
)

REM Define a pasta do projeto (sem barra no final)
set "PROJECT_DIR=%~dp0"
set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

set PORT=8080

REM Muda para o diretório do projeto e inicia o servidor
echo  Iniciando servidor na porta %PORT%...
pushd "%PROJECT_DIR%"
start "Servidor TSP" python -m http.server %PORT%
popd

REM Aguarda o servidor iniciar
timeout /t 2 /nobreak >nul

REM Abre a aplicação no navegador padrão
echo  Abrindo aplicacao no navegador...
start "" "http://localhost:%PORT%/index.html"

echo.
echo  ============================================
echo    Aplicacao rodando em:
echo    http://localhost:%PORT%/index.html
echo.
echo    Pressione qualquer tecla para ENCERRAR
echo    o servidor e fechar a aplicacao.
echo  ============================================
echo.

pause >nul

REM Encerra o processo na porta 8080
echo.
echo  Encerrando servidor...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT% " ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo  Servidor encerrado com sucesso!
timeout /t 2 /nobreak >nul

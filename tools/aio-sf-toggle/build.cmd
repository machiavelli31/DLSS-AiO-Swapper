@echo off
rem Build AiO SF Toggle (ReShade add-on) and its offline locator test with MSVC.
rem Needs: VS Build Tools (vswhere), ReShade 6.8.0 headers in .\include
setlocal
cd /d "%~dp0"
for /f "usebackq tokens=*" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -products * -latest -property installationPath`) do set VSDIR=%%i
call "%VSDIR%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
if not exist out mkdir out
cl /nologo /std:c++20 /EHsc /O2 /W4 /LD /MD /DNOMINMAX /I include /I src src\aio_sf_toggle.cpp /Fo:out\ /Fe:out\aio-sf-toggle.addon64 /link bcrypt.lib || exit /b 3
cl /nologo /std:c++20 /EHsc /O2 /W4 /MD /DNOMINMAX /I src src\test_locate.cpp /Fo:out\ /Fe:out\test_locate.exe /link bcrypt.lib || exit /b 4
echo BUILD OK

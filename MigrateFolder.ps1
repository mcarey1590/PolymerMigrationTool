param(
    $path
)

Get-ChildItem -Path $path -Filter *.html |
    ForEach-Object {
        $tsName = "$($_.BaseName).ts";
        $tsPath = Join-Path $_.Directory $tsName
        if(Test-Path $tsPath){
            return;
        }
        node convert.js $_.FullName
    }
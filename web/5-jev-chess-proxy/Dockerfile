FROM python:3.12-alpine
COPY proxy.py /proxy.py
ENV PORT=8443
EXPOSE 8443
CMD ["python", "-u", "/proxy.py"]

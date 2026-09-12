package com.xwiggy.food.controller;

import com.xwiggy.food.dao.OrderService;
import com.xwiggy.food.model.Order;
import com.xwiggy.food.model.OrderRequest;
import com.xwiggy.food.model.StatusRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.NoSuchElementException;

@RestController
public class OrderController {

    @Autowired
    private OrderService orderService;

    @PostMapping("/order")
    public ResponseEntity<?> createOrder(@RequestBody OrderRequest request, Authentication authentication) {
        try {
            Order order = orderService.createOrder(authentication.getName(), request.getItems());
            return ResponseEntity.ok(order);
        } catch (IllegalArgumentException | NoSuchElementException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(e.getMessage());
        }
    }

    @PostMapping("/order/{id}/pay")
    public ResponseEntity<?> payOrder(@PathVariable int id, Authentication authentication) {
        try {
            Order order = orderService.payOrder(id, authentication.getName());
            return ResponseEntity.ok(order);
        } catch (SecurityException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(e.getMessage());
        } catch (NoSuchElementException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(e.getMessage());
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(e.getMessage());
        } catch (OptimisticLockingFailureException e) {
            // Another request changed this item's stock at the same instant - safe to retry.
            return ResponseEntity.status(HttpStatus.CONFLICT).body("Stock changed while processing payment. Please try again.");
        }
    }

    @GetMapping("/orders")
    public List<Order> getOrders(Authentication authentication) {
        return orderService.getOrderHistory(authentication.getName());
    }

    @GetMapping("/orders/{id}")
    public ResponseEntity<?> getOrder(@PathVariable int id, Authentication authentication) {
        try {
            return ResponseEntity.ok(orderService.getOrderForUser(id, authentication.getName()));
        } catch (SecurityException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(e.getMessage());
        } catch (NoSuchElementException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(e.getMessage());
        }
    }

    // ---- Merchant fulfilment views, gated to ROLE_MERCHANT in SecurityConfig ----

    @GetMapping("/merchant/orders")
    public List<Order> getAllOrders() {
        return orderService.getAllOrders();
    }

    @GetMapping("/merchant/orders/{id}")
    public ResponseEntity<?> getOrder(@PathVariable int id) {
        try {
            return ResponseEntity.ok(orderService.getOrder(id));
        } catch (NoSuchElementException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @PostMapping("/merchant/orders/{id}/status")
    public ResponseEntity<?> updateStatus(@PathVariable int id, @RequestBody StatusRequest request) {
        try {
            return ResponseEntity.ok(orderService.updateStatus(id, request.getStatus()));
        } catch (NoSuchElementException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(e.getMessage());
        }
    }
}
